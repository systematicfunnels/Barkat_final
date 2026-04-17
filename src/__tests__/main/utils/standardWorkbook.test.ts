import { parseStandardWorkbook } from '../../../renderer/src/utils/standardWorkbook'

describe('parseStandardWorkbook', () => {
  test('keeps known and custom ledger charge columns as add-ons', () => {
    const workbook = {
      Project: [
        {
          project_name: 'Beverly',
          city: 'Mumbai'
        }
      ],
      Units: [
        {
          project_name: 'Beverly',
          unit_number: 'A-001',
          owner_name: 'Owner Name',
          area_sqft: 1200,
          unit_type: 'Plot'
        }
      ],
      Ledger: [
        {
          project_name: 'Beverly',
          unit_number: 'A-001',
          financial_year: '2026-27',
          maintenance_amount: 1000,
          na_tax: 200,
          gst: 100,
          'Late Payment Charge': 300,
          other_charge_name: 'Club House Repair',
          other_charge_amount: 250,
          'Solar Contribution as per AGM': 400,
          discount_amount: 50,
          final_amount: 2200,
          due_date: '2027-03-31',
          remarks: 'Imported from ledger'
        }
      ]
    }

    const result = parseStandardWorkbook(workbook)

    expect(result.workbook_blockers).toEqual([])
    expect(result.projects).toHaveLength(1)

    const year = result.projects[0].rows[0].years?.[0]
    expect(year).toBeDefined()
    expect(year?.add_ons).toEqual(
      expect.arrayContaining([
        { name: 'NA Tax', amount: 200 },
        { name: 'GST', amount: 100 },
        { name: 'Late Payment Charge', amount: 300 },
        { name: 'Club House Repair', amount: 250 },
        { name: 'Solar Contribution as per AGM', amount: 400 }
      ])
    )

    expect(year?.add_ons?.map((addon) => addon.name)).not.toContain('Final Amount')
    expect(year?.add_ons).toHaveLength(5)
  })
})
