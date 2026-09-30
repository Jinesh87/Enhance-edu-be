import "reflect-metadata";
import { AppDataSource, ensureMeetingSchema } from "./src/config/data-source";
import { meetingRemindersService } from "./src/modules/meetings/meeting-reminders.service";

async function main() {
  await ensureMeetingSchema();
  await AppDataSource.initialize();
  const holidays = await AppDataSource.query(
    `SELECT name, to_char("startDate",'YYYY-MM-DD') s, to_char("endDate",'YYYY-MM-DD') e, kind FROM holidays ORDER BY "startDate" DESC LIMIT 3`,
  );
  console.log("holidays", holidays);
  const publicHoliday = holidays.find((h: { kind: string }) => h.kind === "PUBLIC");
  if (publicHoliday) {
    const rows = await AppDataSource.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date, h.name
       FROM unnest($1::date[]) AS d
       INNER JOIN holidays h ON h.kind = 'PUBLIC' AND d BETWEEN h."startDate" AND h."endDate"`,
      [[publicHoliday.s, "2000-01-01"]],
    );
    console.log("match", rows);
  }
  const cols = await AppDataSource.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='meeting_requests' AND column_name ILIKE 'outcome%'`,
  );
  console.log("cols", cols.map((c: { column_name: string }) => c.column_name));
  console.log("scan", await meetingRemindersService.runScan());
  await AppDataSource.destroy();
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
