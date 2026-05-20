import type { DateTime } from "luxon";

export type GeniusClosingJobSubmit = {
  submitted: boolean;
  jobName: string;
  message: string;
  startTime: DateTime;
};
