import type { DateTime } from "luxon";

export type GeniusClosingResult = {
  success: boolean;
  startTime: DateTime;
  endTime: DateTime;
  duration: number;
  message: string;
  status?: string;
  errorMessage?: string;
};

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

export type GeniusReadinessCheck = {
  ready: boolean;
  message: string;
};
