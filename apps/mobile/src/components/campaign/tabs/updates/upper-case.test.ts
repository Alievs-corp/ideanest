import { upperCaseIn } from './upper-case';

/**
 * The Updates eyebrow's capitals (#155). iOS's `textTransform: 'uppercase'` draws "YENILIK" for
 * Azerbaijani "Yenilik" — a dotless capital where the language has a dotted one.
 */
describe('upperCaseIn', () => {
  it('keeps the dot on i in Azerbaijani and Turkish', () => {
    expect(upperCaseIn('Yenilik 7', 'az')).toBe('YENİLİK 7');
    expect(upperCaseIn('Güncelleme işi', 'tr')).toBe('GÜNCELLEME İŞİ');
  });

  it('makes the dotless ı a plain I', () => {
    expect(upperCaseIn('ışık', 'tr')).toBe('IŞIK');
  });

  it('is the ordinary capital in English and Russian', () => {
    expect(upperCaseIn('Update 7', 'en')).toBe('UPDATE 7');
    expect(upperCaseIn('Обновление 7', 'ru')).toBe('ОБНОВЛЕНИЕ 7');
  });
});
