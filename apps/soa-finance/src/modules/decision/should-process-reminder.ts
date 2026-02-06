import type { SoaType } from "../../types";

export const shouldProcessReminder = (
  hasExistingReminders: boolean,
  processingType: SoaType
): boolean => {
  if (!hasExistingReminders && processingType === 1) {
    return false;
  }

  return true;
};
