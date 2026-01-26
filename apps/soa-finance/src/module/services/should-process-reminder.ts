import { SoaType } from "../utils/types";

export const shouldProcessReminder = (
  hasExistingReminders: boolean,
  processingType: SoaType
): boolean => {
  if (!hasExistingReminders && processingType === SoaType.SOA) {
    return false;
  }

  return true;
};
