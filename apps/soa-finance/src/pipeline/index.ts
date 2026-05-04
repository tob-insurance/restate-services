import { isDevelopment } from "../constants";
import type { IStatementOfAccountModel } from "../types";
import { streamSoaData } from "./read";
import { transformSoaStream } from "./transform";
import type { ISoaPipelineResult } from "./types";
import { writeToParquet } from "./write";

function generateDevData(): IStatementOfAccountModel[] {
  const now = new Date();
  const mmyy = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

  // Helper to create a row with defaults overridden
  const row = (
    overrides: Partial<IStatementOfAccountModel>
  ): IStatementOfAccountModel => ({
    debitAndCreditNoteNo: "DC-000",
    branch: "01",
    policyNo: "POL-00000",
    policyEndNo: "000",
    contractNo: "CN-000",
    plateNo: "-",
    coInFacRefNo: "",
    fireConjunctionPolicy: "",
    lob: "MOTOR",
    sourceOfBusiness: "AGENT",
    accountName: "PT DEFAULT",
    insuredName: "INSURED DEFAULT",
    distributionName: "DIST DEFAULT",
    distributionNameSecond: "",
    qualitateQuaName: "BROKER",
    endEffDate: mmyy,
    endExpDate: mmyy,
    postDate: mmyy,
    dueDate: mmyy,
    aging: 90,
    currency: "IDR",
    exchangeRate: 1,
    endReason: "",
    actingCode: "DIC",
    totalSumInsured: 100_000_000,
    grossPremium: 5_000_000,
    discount: 500_000,
    commission: 1_000_000,
    ppn: 550_000,
    pph21: 0,
    pph23: 0,
    cost: 0,
    stmp: 5000,
    netPremium: 2_955_000,
    netPremiumIdr: 2_955_000,
    installment: "1/1",
    origAmount: 2_955_000,
    customerCode: "00000000",
    distributionCode: "00000000",
    ...overrides,
  });

  return [
    // == Customer A (00004162): DIC multi-branch, MOTOR, 2 installments ==
    row({
      debitAndCreditNoteNo: "DC-2025-001",
      branch: "01",
      policyNo: "MTR-2024-001",
      contractNo: "CN-A001",
      plateNo: "B 1234 XYZ",
      lob: "MOTOR",
      sourceOfBusiness: "AGENT",
      accountName: "PT SEJAHTERA MOTORINDO",
      insuredName: "BUDI SANTOSO",
      distributionName: "PT SEJAHTERA MOTORINDO",
      qualitateQuaName: "BROKER",
      aging: 90,
      actingCode: "DIC",
      totalSumInsured: 500_000_000,
      grossPremium: 25_000_000,
      discount: 2_500_000,
      commission: 5_000_000,
      ppn: 2_750_000,
      stmp: 10_000,
      netPremium: 15_260_000,
      netPremiumIdr: 15_260_000,
      installment: "1/2",
      origAmount: 15_260_000,
      customerCode: "00004162",
      distributionCode: "00004162",
    }),
    row({
      debitAndCreditNoteNo: "DC-2025-002",
      branch: "01",
      policyNo: "MTR-2024-001",
      contractNo: "CN-A001",
      plateNo: "B 1234 XYZ",
      lob: "MOTOR",
      sourceOfBusiness: "AGENT",
      accountName: "PT SEJAHTERA MOTORINDO",
      insuredName: "BUDI SANTOSO",
      distributionName: "PT SEJAHTERA MOTORINDO",
      qualitateQuaName: "BROKER",
      aging: 61,
      actingCode: "DIC",
      totalSumInsured: 500_000_000,
      grossPremium: 25_000_000,
      discount: 2_500_000,
      commission: 5_000_000,
      ppn: 2_750_000,
      stmp: 10_000,
      netPremium: 15_260_000,
      netPremiumIdr: 15_260_000,
      installment: "2/2",
      origAmount: 15_260_000,
      customerCode: "00004162",
      distributionCode: "00004162",
    }),

    // == Customer A: additional policy (branch JAKARTA PUSAT) ==
    row({
      debitAndCreditNoteNo: "DC-2025-003",
      branch: "22",
      policyNo: "MTR-2024-005",
      contractNo: "CN-A002",
      plateNo: "B 5678 WXY",
      lob: "MOTOR",
      sourceOfBusiness: "AGENT",
      accountName: "PT SEJAHTERA MOTORINDO",
      insuredName: "SITI RAHMAWATI",
      distributionName: "PT SEJAHTERA MOTORINDO",
      qualitateQuaName: "BROKER",
      aging: 75,
      actingCode: "DIC",
      totalSumInsured: 350_000_000,
      grossPremium: 17_500_000,
      discount: 1_750_000,
      commission: 3_500_000,
      ppn: 1_925_000,
      stmp: 7000,
      netPremium: 10_682_000,
      netPremiumIdr: 10_682_000,
      installment: "1/1",
      origAmount: 10_682_000,
      customerCode: "00004162",
      distributionCode: "00004162",
    }),

    // == Customer B (00004829): DIP multi-branch, PROPERTY + MARINE ==
    row({
      debitAndCreditNoteNo: "DC-2025-004",
      branch: "03",
      policyNo: "PRO-2023-001",
      contractNo: "CN-B001",
      plateNo: "-",
      lob: "PROPERTY",
      sourceOfBusiness: "DIRECT",
      accountName: "PT BANGUN KREASI",
      insuredName: "PT BANGUN KREASI",
      distributionName: "PT BANGUN KREASI",
      qualitateQuaName: "AGENT",
      aging: 150,
      actingCode: "DIP",
      endReason: "RENEWAL",
      totalSumInsured: 2_000_000_000,
      grossPremium: 100_000_000,
      discount: 10_000_000,
      commission: 20_000_000,
      ppn: 11_000_000,
      pph23: 2_000_000,
      cost: 1_000_000,
      stmp: 40_000,
      netPremium: 57_960_000,
      netPremiumIdr: 57_960_000,
      installment: "1/3",
      origAmount: 57_960_000,
      customerCode: "00004829",
      distributionCode: "00004829",
    }),
    row({
      debitAndCreditNoteNo: "DC-2025-005",
      branch: "03",
      policyNo: "PRO-2023-001",
      contractNo: "CN-B001",
      plateNo: "-",
      lob: "PROPERTY",
      sourceOfBusiness: "DIRECT",
      accountName: "PT BANGUN KREASI",
      insuredName: "PT BANGUN KREASI",
      distributionName: "PT BANGUN KREASI",
      qualitateQuaName: "AGENT",
      aging: 90,
      actingCode: "DIP",
      totalSumInsured: 2_000_000_000,
      grossPremium: 100_000_000,
      discount: 10_000_000,
      commission: 20_000_000,
      ppn: 11_000_000,
      pph23: 2_000_000,
      cost: 1_000_000,
      stmp: 40_000,
      netPremium: 57_960_000,
      netPremiumIdr: 57_960_000,
      installment: "2/3",
      origAmount: 57_960_000,
      customerCode: "00004829",
      distributionCode: "00004829",
    }),
    row({
      debitAndCreditNoteNo: "DC-2025-006",
      branch: "03",
      policyNo: "PRO-2023-001",
      contractNo: "CN-B001",
      plateNo: "-",
      lob: "PROPERTY",
      sourceOfBusiness: "DIRECT",
      accountName: "PT BANGUN KREASI",
      insuredName: "PT BANGUN KREASI",
      distributionName: "PT BANGUN KREASI",
      qualitateQuaName: "AGENT",
      aging: 30, // < 60 — should be filtered out by batch
      actingCode: "DIP",
      totalSumInsured: 2_000_000_000,
      grossPremium: 100_000_000,
      discount: 10_000_000,
      commission: 20_000_000,
      ppn: 11_000_000,
      pph23: 2_000_000,
      cost: 1_000_000,
      stmp: 40_000,
      netPremium: 57_960_000,
      netPremiumIdr: 57_960_000,
      installment: "3/3",
      origAmount: 57_960_000,
      customerCode: "00004829",
      distributionCode: "00004829",
    }),

    // == Customer C (00005017): DIG multi-branch, FLEET ==
    row({
      debitAndCreditNoteNo: "DC-2025-007",
      branch: "08",
      policyNo: "FLT-2024-010",
      contractNo: "CN-C001",
      plateNo: "L 9012 PQR",
      coInFacRefNo: "CO-RE-001",
      lob: "FLEET",
      sourceOfBusiness: "BROKER",
      accountName: "PT ANGKUTAN SEJAHTERA",
      insuredName: "AGUS WIDODO",
      distributionName: "PT ANGKUTAN SEJAHTERA",
      qualitateQuaName: "BROKER",
      aging: 180,
      actingCode: "DIG",
      totalSumInsured: 5_000_000_000,
      grossPremium: 250_000_000,
      discount: 25_000_000,
      commission: 50_000_000,
      ppn: 27_500_000,
      pph21: 5_000_000,
      pph23: 2_500_000,
      cost: 2_000_000,
      stmp: 100_000,
      netPremium: 143_100_000,
      netPremiumIdr: 143_100_000,
      installment: "1/6",
      origAmount: 143_100_000,
      customerCode: "00005017",
      distributionCode: "00005017",
    }),
    row({
      debitAndCreditNoteNo: "DC-2025-008",
      branch: "08",
      policyNo: "FLT-2024-010",
      contractNo: "CN-C001",
      plateNo: "L 9012 PQR",
      coInFacRefNo: "CO-RE-001",
      lob: "FLEET",
      sourceOfBusiness: "BROKER",
      accountName: "PT ANGKUTAN SEJAHTERA",
      insuredName: "AGUS WIDODO",
      distributionName: "PT ANGKUTAN SEJAHTERA",
      qualitateQuaName: "BROKER",
      aging: 120,
      actingCode: "DIG",
      totalSumInsured: 5_000_000_000,
      grossPremium: 250_000_000,
      discount: 25_000_000,
      commission: 50_000_000,
      ppn: 27_500_000,
      pph21: 5_000_000,
      pph23: 2_500_000,
      cost: 2_000_000,
      stmp: 100_000,
      netPremium: 143_100_000,
      netPremiumIdr: 143_100_000,
      installment: "2/6",
      origAmount: 143_100_000,
      customerCode: "00005017",
      distributionCode: "00005017",
    }),

    // == Customer D (00003758): DID multi-branch, ENGINEERING ==
    row({
      debitAndCreditNoteNo: "DC-2025-009",
      branch: "10",
      policyNo: "ENG-2024-020",
      contractNo: "CN-D001",
      plateNo: "-",
      lob: "ENGINEERING",
      sourceOfBusiness: "DIRECT",
      accountName: "PT KONSTRUKSI MANDIRI",
      insuredName: "PT KONSTRUKSI MANDIRI",
      distributionName: "PT KONSTRUKSI MANDIRI",
      qualitateQuaName: "AGENT",
      aging: 65,
      actingCode: "DID",
      totalSumInsured: 10_000_000_000,
      grossPremium: 500_000_000,
      discount: 50_000_000,
      commission: 100_000_000,
      ppn: 55_000_000,
      pph23: 10_000_000,
      cost: 5_000_000,
      stmp: 200_000,
      netPremium: 289_800_000,
      netPremiumIdr: 289_800_000,
      installment: "1/1",
      origAmount: 289_800_000,
      customerCode: "00003758",
      distributionCode: "00003758",
    }),

    // == Customer E (00003390): Regular, MARINE CARGO (USD) ==
    row({
      debitAndCreditNoteNo: "DC-2025-010",
      branch: "14",
      policyNo: "MAR-2025-001",
      contractNo: "CN-E001",
      plateNo: "-",
      lob: "MARINE CARGO",
      sourceOfBusiness: "BROKER",
      accountName: "PT LOGISTIK NUSANTARA",
      insuredName: "CARGO DEPT",
      distributionName: "PT LOGISTIK NUSANTARA",
      qualitateQuaName: "BROKER",
      aging: 85,
      currency: "USD",
      exchangeRate: 16_200,
      actingCode: "KPO",
      totalSumInsured: 100_000,
      grossPremium: 5000,
      discount: 500,
      commission: 1000,
      ppn: 550,
      pph21: 0,
      pph23: 0,
      cost: 100,
      stmp: 50,
      netPremium: 2900,
      netPremiumIdr: 46_980_000,
      installment: "1/1",
      origAmount: 2900,
      customerCode: "00003390",
      distributionCode: "00003390",
    }),

    // == Customer F (00002844): Regular, HEALTH (under 60 aging, will be filtered) ==
    row({
      debitAndCreditNoteNo: "DC-2025-011",
      branch: "20",
      policyNo: "HLT-2025-005",
      contractNo: "CN-F001",
      plateNo: "-",
      lob: "HEALTH",
      sourceOfBusiness: "AGENT",
      accountName: "PT LAYANAN SEHAT",
      insuredName: "RUMAH SAKIT UMUM",
      distributionName: "PT LAYANAN SEHAT",
      qualitateQuaName: "AGENT",
      aging: 45, // < 60 — should be filtered out by batch
      actingCode: "KPO",
      totalSumInsured: 2_000_000_000,
      grossPremium: 100_000_000,
      discount: 10_000_000,
      commission: 20_000_000,
      ppn: 11_000_000,
      cost: 0,
      stmp: 40_000,
      netPremium: 60_960_000,
      netPremiumIdr: 60_960_000,
      installment: "1/1",
      origAmount: 60_960_000,
      customerCode: "00002844",
      distributionCode: "00002844",
    }),
  ];
}

// Run complete SOA pipeline: Oracle → Transform → Parquet by account code → upload to Azure Blob

export async function generateSoaPipeline(
  asAtDate: Date
): Promise<ISoaPipelineResult> {
  console.log("[Pipeline] Starting SOA pipeline");

  if (isDevelopment()) {
    console.log("[Pipeline] DEV MODE: using synthetic test data");
    const testData = generateDevData();
    const testStream: AsyncIterable<IStatementOfAccountModel> = {
      [Symbol.asyncIterator]() {
        let i = -1;
        return {
          next: () =>
            Promise.resolve().then(
              (): IteratorResult<IStatementOfAccountModel> => {
                i += 1;
                return i < testData.length
                  ? { value: testData[i], done: false as const }
                  : { value: undefined, done: true as const };
              }
            ),
        };
      },
    };
    await writeToParquet(testStream, asAtDate);
    console.log("[Pipeline] Dev pipeline completed");
    return { success: true };
  }

  // Create pipeline: Reader → Transformer
  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  // Write to Parquet
  await writeToParquet(transformedStream, asAtDate);

  console.log("[Pipeline] Completed");

  return {
    success: true,
  };
}

export async function collectPipelineData(
  asAtDate: Date
): Promise<Map<string, IStatementOfAccountModel[]>> {
  console.log("[Pipeline] Collecting data from Oracle");

  const oracleStream = streamSoaData(asAtDate);
  const transformedStream = transformSoaStream(oracleStream);

  const datasAccount = new Map<string, IStatementOfAccountModel[]>();

  for await (const row of transformedStream) {
    const accountCode = row.distributionCode;

    if (!datasAccount.has(accountCode)) {
      datasAccount.set(accountCode, []);
    }

    datasAccount.get(accountCode)?.push(row);
  }

  console.log(`[Pipeline] Collected ${datasAccount.size} accounts`);

  return datasAccount;
}
