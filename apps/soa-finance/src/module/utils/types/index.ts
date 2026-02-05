export type { IAccount, IBranch, IGetSoaJob } from "./customer";

export type {
  IEmailAttachment,
  IEmailMessage,
  ISendEmailResult,
} from "./email";

export type {
  IOracleStreamOptions,
  IPartitionedFile,
  ISoaPipelineResult,
} from "./pipeline";

export type { IReminderEmailData } from "./reminder";

export type {
  IExcelColumn,
  IExcelSheetData,
  IGenerateReportParams,
  IReportOptions,
  IReportResult,
  ISoaFileResult,
} from "./report";

export {
  column,
  type IFileData,
  type IGenerateReminderResult,
  type IProcessReminder,
  type ISoaItem,
  type ISoaReminder,
  type IStatementOfAccountModel,
  multiBranchCodes,
  SoaPhase,
  SoaType,
} from "./soa";

export type { soaSchema } from "./soa-schema";
