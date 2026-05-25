import type { DateTime } from "luxon";

export interface GeniusClosingJobSubmit {
  jobName: string;
  message: string;
  startTime: DateTime;
  submitted: boolean;
}
