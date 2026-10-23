import { describe, expect, it } from 'vitest';
import { creatorAgreementRefusalOf, pendingCreatorAgreement } from './agreements';

const backer = { document: 'BACKER_AGREEMENT', inForce: true, version: 2, effectiveFrom: '2026-09-01T00:00:00Z' };
const creator = { document: 'CREATOR_AGREEMENT', inForce: true, version: 4, effectiveFrom: '2026-10-13T20:47:38Z' };

describe('pendingCreatorAgreement', () => {
  it('asks for the version in force when it has not been accepted', () => {
    expect(pendingCreatorAgreement({ agreements: [backer, creator] })).toEqual({
      version: 4,
      effectiveFrom: '2026-10-13T20:47:38Z',
    });
  });

  it('asks nothing once accepted, when nothing is published, or for a body it cannot read', () => {
    expect(pendingCreatorAgreement({ agreements: [{ ...creator, acceptedAt: '2026-10-20T10:00:00Z' }] })).toBeNull();
    expect(pendingCreatorAgreement({ agreements: [{ document: 'CREATOR_AGREEMENT', inForce: false, version: 0 }] })).toBeNull();
    expect(pendingCreatorAgreement({ agreements: [backer] })).toBeNull();
    expect(pendingCreatorAgreement({ agreements: [{ ...creator, version: '4' }] })).toBeNull();
    expect(pendingCreatorAgreement(null)).toBeNull();
  });
});

describe('creatorAgreementRefusalOf', () => {
  const meta = { requires: 'ACCEPTANCE', document: 'CREATOR_AGREEMENT', version: 4, effectiveFrom: '2026-10-13T20:47:38Z' };

  it('reads what the refusal asks for', () => {
    expect(creatorAgreementRefusalOf('AGREEMENT_REQUIRED', meta)).toEqual({
      requires: 'ACCEPTANCE',
      version: 4,
      effectiveFrom: '2026-10-13T20:47:38Z',
    });
    expect(creatorAgreementRefusalOf('AGREEMENT_REQUIRED', { ...meta, requires: 'SIGNATURE' })?.requires).toBe('SIGNATURE');
  });

  it('ignores other refusals and other documents', () => {
    expect(creatorAgreementRefusalOf('PLAN_LIMIT_EXCEEDED', meta)).toBeNull();
    expect(creatorAgreementRefusalOf('AGREEMENT_REQUIRED', { ...meta, document: 'BACKER_AGREEMENT' })).toBeNull();
    expect(creatorAgreementRefusalOf('AGREEMENT_REQUIRED', undefined)).toBeNull();
  });
});
