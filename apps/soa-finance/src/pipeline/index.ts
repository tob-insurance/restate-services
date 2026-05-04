import { isDevelopment } from "../constants";
import type { IStatementOfAccountModel } from "../types";
import { streamSoaData } from "./read";
import { transformSoaStream } from "./transform";
import type { ISoaPipelineResult } from "./types";
import { writeToParquet } from "./write";

function generateDevData(): IStatementOfAccountModel[] {
  const now = new Date();
  const mmyy = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

  return [
    {
      debitAndCreditNoteNo: "DC-001",
      branch: "JAKARTA",
      policyNo: "POL-2023-00001",
      policyEndNo: "000",
      contractNo: "CN-001",
      plateNo: "B 1234 XYZ",
      coInFacRefNo: "",
      fireConjunctionPolicy: "",
      lob: "MOTOR",
      sourceOfBusiness: "AGENT",
      accountName: "PT TEST CUSTOMER A",
      insuredName: "JOHN DOE",
      distributionName: "PT DISTRIBUTOR A",
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
      totalSumInsured: 500_000_000,
      grossPremium: 25_000_000,
      discount: 2_500_000,
      commission: 5_000_000,
      ppn: 2_750_000,
      pph21: 0,
      pph23: 0,
      cost: 0,
      stmp: 10_000,
      netPremium: 15_260_000,
      netPremiumIdr: 15_260_000,
      installment: "1/2",
      origAmount: 15_260_000,
      customerCode: "00004162",
      distributionCode: "00004162",
    },
    {
      debitAndCreditNoteNo: "DC-002",
      branch: "JAKARTA",
      policyNo: "POL-2023-00001",
      policyEndNo: "000",
      contractNo: "CN-001",
      plateNo: "B 1234 XYZ",
      coInFacRefNo: "",
      fireConjunctionPolicy: "",
      lob: "MOTOR",
      sourceOfBusiness: "AGENT",
      accountName: "PT TEST CUSTOMER A",
      insuredName: "JOHN DOE",
      distributionName: "PT DISTRIBUTOR A",
      distributionNameSecond: "",
      qualitateQuaName: "BROKER",
      endEffDate: mmyy,
      endExpDate: mmyy,
      postDate: mmyy,
      dueDate: mmyy,
      aging: 61,
      currency: "IDR",
      exchangeRate: 1,
      endReason: "",
      actingCode: "DIC",
      totalSumInsured: 200_000_000,
      grossPremium: 10_000_000,
      discount: 1_000_000,
      commission: 2_000_000,
      ppn: 1_100_000,
      pph21: 0,
      pph23: 0,
      cost: 0,
      stmp: 5000,
      netPremium: 6_105_000,
      netPremiumIdr: 6_105_000,
      installment: "2/2",
      origAmount: 6_105_000,
      customerCode: "00004162",
      distributionCode: "00004162",
    },
    {
      debitAndCreditNoteNo: "DC-003",
      branch: "BANDUNG",
      policyNo: "POL-2024-00002",
      policyEndNo: "000",
      contractNo: "CN-002",
      plateNo: "D 5678 ABC",
      coInFacRefNo: "",
      fireConjunctionPolicy: "",
      lob: "PROPERTY",
      sourceOfBusiness: "DIRECT",
      accountName: "PT TEST CUSTOMER B",
      insuredName: "JANE SMITH",
      distributionName: "PT DISTRIBUTOR B",
      distributionNameSecond: "CABANG BANDUNG",
      qualitateQuaName: "AGENT",
      endEffDate: mmyy,
      endExpDate: mmyy,
      postDate: mmyy,
      dueDate: mmyy,
      aging: 120,
      currency: "IDR",
      exchangeRate: 1,
      endReason: "",
      actingCode: "DIP",
      totalSumInsured: 1_000_000_000,
      grossPremium: 50_000_000,
      discount: 5_000_000,
      commission: 10_000_000,
      ppn: 5_500_000,
      pph21: 0,
      pph23: 0,
      cost: 500_000,
      stmp: 20_000,
      netPremium: 30_020_000,
      netPremiumIdr: 30_020_000,
      installment: "1/4",
      origAmount: 30_020_000,
      customerCode: "00004829",
      distributionCode: "00004829",
    },
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
    const testStream = {
      [Symbol.asyncIterator]() {
        let i = -1;
        return {
          next: () =>
            Promise.resolve().then(() => {
              i += 1;
              return i < testData.length
                ? { value: testData[i], done: false }
                : { value: undefined, done: true };
            }),
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
