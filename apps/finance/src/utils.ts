// Deprecated - kept for backward compatibility
export function sendNotification(greetingId: string, name: string) {
  console.log(`Notification sent: ${greetingId} - ${name}`);
}

export function sendReminder(greetingId: string, name: string) {
  console.log(`Reminder sent: ${greetingId}`);
}
