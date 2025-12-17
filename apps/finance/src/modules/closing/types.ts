import type { DateTime } from "luxon";

export type GeniusClosingJobSubmit = {
  submitted: boolean;
  jobName: string;
  message: string;
  startTime: DateTime;
};

export type GeniusJobStatus = {
  status: string;
  running: boolean;
  completed: boolean;
  failed: boolean;
  message: string;
};
