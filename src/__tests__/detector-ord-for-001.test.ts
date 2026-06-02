/**
 * ORD-FOR-001 — Order activated, no billing schedule.
 */
import { describe, it, expect } from 'vitest';
import ORD_FOR_001 from '@/lib/forensics/detectors/ord-for-001-order-no-billing';
import { buildMockConn, makeCtx } from './_detector-test-helpers';

describe('ORD-FOR-001 detector', () => {
  it('skips when Salesforce Billing is not installed', async () => {
    const conn = buildMockConn({ describeMissingObjects: new Set(['blng__BillingSchedule__c']) });
    expect(await ORD_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('empty org with Billing → no findings', async () => {
    const conn = buildMockConn({ tables: { Order: [] } });
    expect(await ORD_FOR_001.run(makeCtx(conn))).toEqual([]);
  });

  it('Order with schedules covering all items → not flagged', async () => {
    const conn = buildMockConn({
      tables: {
        Order: [{ Id: 'O1', OrderNumber: 'O-1', Status: 'Activated', ActivatedDate: '2026-04-01', TotalAmount: '5000', AccountId: 'A1' }],
        OrderItem: [{ Id: 'OI1', OrderId: 'O1', UnitPrice: '500', Quantity: '10', Product2Id: 'P1', Product2: { Name: 'Widget' }, blng__BillingRule__c: 'BR1' }],
        blng__BillingSchedule__c: [{ Id: 'BS1', blng__OrderProduct__c: 'OI1' }],
      },
    });
    expect(await ORD_FOR_001.run(makeCtx(conn))).toEqual([]);
  });
});
