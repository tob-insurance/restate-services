const enDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatEnDate(date: Date): string {
  return enDateFormatter.format(date);
}
