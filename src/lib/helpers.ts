export function trimText(input: string, maxLength: number = 100): string {
  if (input.length <= maxLength) return input;
  return input.substring(0, maxLength - 3) + "...";
}
export function getCurrentTimeInItaly(): Date {
  const nowInItaly = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }),
  );
  return nowInItaly;
}

export function getCurrentTimeInTimezone(timezone: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
}

export function formatTimeTo12H(date: Date, timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true, // Use 12-hour format with AM/PM
    ...(timezone ? { timeZone: timezone } : {}),
  };

  return new Intl.DateTimeFormat("en-US", options).format(date);
}
export function formatDate(date: Date, locale: string = "en-US"): string {
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function calculateYearsOfExperience(
  startDate: string | Date = "2023-05-01",
  currentDate: Date = new Date(),
): number {
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  let years = currentDate.getFullYear() - start.getFullYear();
  const monthDiff = currentDate.getMonth() - start.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && currentDate.getDate() < start.getDate())) {
    years--;
  }
  return Math.max(0, years);
}
