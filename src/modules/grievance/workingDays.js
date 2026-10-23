/*
 * Working-day arithmetic for the vendor site-visit timer.
 *
 * GBU works Monday to Saturday, except Sundays, the 2nd and 4th Saturday of the
 * month, and the holidays the admin enters. All dates are calendar dates in IST
 * regardless of the server's own timezone.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value) => String(value).padStart(2, '0');

// Calendar date (in IST) of an instant, as a UTC-midnight Date so day math is DST-free.
const istCalendarDay = (instant) => {
    const shifted = new Date(new Date(instant).getTime() + IST_OFFSET_MS);
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

const toDateKey = (calendarDay) =>
    `${calendarDay.getUTCFullYear()}-${pad(calendarDay.getUTCMonth() + 1)}-${pad(calendarDay.getUTCDate())}`;

const todayIstKey = (now = new Date()) => toDateKey(istCalendarDay(now));

const isWorkingDay = (calendarDay, holidayKeys = new Set()) => {
    const dayOfWeek = calendarDay.getUTCDay();
    if (dayOfWeek === 0) return false;

    if (dayOfWeek === 6) {
        const dayOfMonth = calendarDay.getUTCDate();
        const isSecondSaturday = dayOfMonth >= 8 && dayOfMonth <= 14;
        const isFourthSaturday = dayOfMonth >= 22 && dayOfMonth <= 28;
        if (isSecondSaturday || isFourthSaturday) return false;
    }

    return !holidayKeys.has(toDateKey(calendarDay));
};

/*
 * Deadline for something that must happen within `workingDays` working days of
 * `from`: the end (23:59:59 IST) of the Nth working day after the day of `from`.
 * Assigned Monday 3 PM with N = 2 -> due Wednesday 23:59:59 IST.
 */
const addWorkingDaysDeadline = (from, workingDays, holidayKeys = new Set()) => {
    let cursor = istCalendarDay(from);
    let counted = 0;

    while (counted < workingDays) {
        cursor = new Date(cursor.getTime() + DAY_MS);
        if (isWorkingDay(cursor, holidayKeys)) counted += 1;
    }

    const endOfDayIst = cursor.getTime() + DAY_MS - 1000;
    return new Date(endOfDayIst - IST_OFFSET_MS);
};

module.exports = {
    istCalendarDay,
    toDateKey,
    todayIstKey,
    isWorkingDay,
    addWorkingDaysDeadline,
};
