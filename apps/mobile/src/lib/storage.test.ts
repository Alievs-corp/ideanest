import * as SecureStore from 'expo-secure-store';
import {
  DEVICE_STORE_ID,
  STORE_KEY_ITEM,
  deviceStore,
  memoryStore,
  openDeviceStore,
  type StorePlatform,
} from './storage';

/**
 * The device store's encryption at rest — #587. MMKV is native, so the platform is a fake that
 * records what was opened, with which key, and whether the plain store was converted.
 */

type OpenConfig = Parameters<StorePlatform['open']>[0];

function platform(overrides: Partial<StorePlatform> & { key?: string | null } = {}) {
  const opened: OpenConfig[] = [];
  const encrypted: { key: string; type: string | undefined }[] = [];
  let stored: string | null = overrides.key ?? null;
  const forgotten: string[] = [];

  const fake: StorePlatform = {
    open: (config) => {
      opened.push(config);
      const store = memoryStore();
      return {
        ...store,
        remove: (key: string) => {
          store.remove(key);
          return true;
        },
        getAllKeys: () => [...store.getAllKeys()],
        encrypt: (key: string, type?: 'AES-128' | 'AES-256') => void encrypted.push({ key, type }),
      };
    },
    readKey: () => stored,
    writeKey: (key) => {
      stored = key;
    },
    forgetKey: () => {
      forgotten.push(stored ?? '');
      stored = null;
    },
    newKey: () => 'k'.repeat(32),
    ...overrides,
  };
  return { fake, opened, encrypted, forgotten, stored: () => stored };
}

describe('the device store', () => {
  it('opens under the key the keychain already holds, without converting anything', () => {
    const phone = platform({ key: 'a'.repeat(32) });

    openDeviceStore(phone.fake);

    expect(phone.opened).toEqual([
      { id: DEVICE_STORE_ID, encryptionKey: 'a'.repeat(32), encryptionType: 'AES-256' },
    ]);
    expect(phone.encrypted).toEqual([]);
  });

  /*
   * The first launch after the update: an older build left the file in plain text. The key is
   * saved before the file is converted, so a crash in between cannot leave a file nobody holds
   * the key to.
   */
  it('makes a key on the first launch, keeps it, then encrypts the plain store in place', () => {
    const order: string[] = [];
    const phone = platform();
    const write = phone.fake.writeKey;
    const open = phone.fake.open;
    const store = openDeviceStore({
      ...phone.fake,
      writeKey: (key) => {
        order.push('write');
        write(key);
      },
      open: (config) => {
        const opened = open(config);
        return {
          ...opened,
          encrypt: (key, type) => {
            order.push('encrypt');
            opened.encrypt(key, type);
          },
        };
      },
    });

    expect(phone.stored()).toBe('k'.repeat(32));
    expect(phone.opened).toEqual([{ id: DEVICE_STORE_ID }]);
    expect(phone.encrypted).toEqual([{ key: 'k'.repeat(32), type: 'AES-256' }]);
    expect(order).toEqual(['write', 'encrypt']);

    store.set('cache', 'kept');
    expect(store.getString('cache')).toBe('kept');
  });

  it('takes the key back out when the conversion fails, so the next launch tries again', () => {
    const phone = platform();
    const open = phone.fake.open;

    const store = openDeviceStore({
      ...phone.fake,
      open: (config) => ({
        ...open(config),
        encrypt: () => {
          throw new Error('MMKV could not recrypt');
        },
      }),
    });

    expect(phone.forgotten).toEqual(['k'.repeat(32)]);
    expect(phone.stored()).toBeNull();
    // A store in memory: nothing more is written to the plain file.
    store.set('a', 'b');
    expect(store.getString('a')).toBe('b');
  });

  it('falls back to memory, never to the plain file, when the keychain cannot be read', () => {
    const phone = platform({
      readKey: () => {
        throw new Error('Keystore unavailable');
      },
    });

    openDeviceStore(phone.fake);

    expect(phone.opened).toEqual([]);
  });

  it('falls back to memory, and leaves the file alone, when the new key cannot be kept', () => {
    const phone = platform({
      writeKey: () => {
        throw new Error('Keystore unavailable');
      },
    });

    openDeviceStore(phone.fake);

    expect(phone.opened).toEqual([]);
    expect(phone.encrypted).toEqual([]);
  });

  /*
   * The real module, on the jest keychain: importing it made a key and kept it under its own
   * item, only on this device.
   */
  it('keeps its key in the keychain under its own item', () => {
    const keychain = SecureStore as unknown as { getItem: (key: string) => string | null };

    expect(keychain.getItem(STORE_KEY_ITEM)).toMatch(/^[0-9a-f]{32}$/);
    deviceStore.set('probe', '1');
    expect(deviceStore.getString('probe')).toBe('1');
    deviceStore.remove('probe');
  });
});
