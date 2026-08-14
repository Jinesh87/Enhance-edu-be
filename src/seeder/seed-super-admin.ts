import { AppDataSource } from "../config/data-source.js";
import { logger } from "../config/logger.js";
import { UserRole, UserStatus } from "../common/constants/roles.js";
import { hashPassword } from "../common/utils/password.js";
import { env } from "../config/env.js";
import {
  User,
  Class,
  Session,
  ClassStudent,
  AttendanceRecord,
  AttendanceStatus,
  ScanEvent,
  ScanStatus,
  ScanFlagReason,
} from "../entities/index.js";

export async function seedSuperAdmin(): Promise<void> {
  const email = env.SEED_SUPER_ADMIN_EMAIL
    .trim()
    .toLowerCase();
  const password = env.SEED_SUPER_ADMIN_PASSWORD;
  const fullName = env.SEED_SUPER_ADMIN_NAME;

  const usersRepo = AppDataSource.getRepository(User);
  const classesRepo = AppDataSource.getRepository(Class);
  const sessionsRepo = AppDataSource.getRepository(Session);
  const enrolmentsRepo = AppDataSource.getRepository(ClassStudent);
  const attendanceRepo = AppDataSource.getRepository(AttendanceRecord);
  const scansRepo = AppDataSource.getRepository(ScanEvent);

  const existing = await usersRepo.findOne({ where: { email } });

  if (existing) {
    logger.info(
      { email },
      "Super admin already seeded. Checking rest of the seed data...",
    );
  } else {
    const user = usersRepo.create({
      fullName,
      preferredName: null,
      email,
      mobile: null,
      passwordHash: await hashPassword(password),
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      employmentType: null,
      securitySetupComplete: true,
      invitationTokenHash: null,
      invitationExpiresAt: null,
    });
    await usersRepo.save(user);
    logger.info({ email }, "Seeded SUPER_ADMIN");
  }

  // 1. Seed Teacher (Kassem Haddad)
  const teacherEmail = "staff@example.com";
  let teacher = await usersRepo.findOne({ where: { email: teacherEmail } });
  if (!teacher) {
    teacher = usersRepo.create({
      fullName: "Kassem Haddad",
      preferredName: "Kassem",
      email: teacherEmail,
      mobile: "0499 999 999",
      passwordHash: await hashPassword("Superadmin@123"),
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      employmentType: null,
      securitySetupComplete: true,
    });
    await usersRepo.save(teacher);
    logger.info("Seeded Teacher (Kassem Haddad)");
  }

  // 2. Seed Students
  const studentsData = [
    {
      fullName: "Leo Karim",
      preferredName: "Leo",
      email: "student@example.com",
    },
    { fullName: "Mia Nguyen", preferredName: "Mia", email: "mia@example.com" },
    {
      fullName: "Lucas Tran",
      preferredName: "Lucas",
      email: "lucas@example.com",
    },
    {
      fullName: "Priya Sharma",
      preferredName: "Priya",
      email: "priya@example.com",
    },
    {
      fullName: "Noah Petrov",
      preferredName: "Noah",
      email: "noah@example.com",
    },
    { fullName: "Ivy Zhang", preferredName: "Ivy", email: "ivy@example.com" },
    {
      fullName: "Ethan Walsh",
      preferredName: "Ethan",
      email: "ethan@example.com",
    },
    {
      fullName: "Zara Ahmed",
      preferredName: "Zara",
      email: "zara@example.com",
    },
    {
      fullName: "Jayden Cole",
      preferredName: "Jayden",
      email: "jayden@example.com",
    },
    {
      fullName: "Ruby Lawson",
      preferredName: "Ruby",
      email: "ruby@example.com",
    },
    {
      fullName: "Sami Karim",
      preferredName: "Sami",
      email: "sami@example.com",
    },
  ];

  const studentsMap: { [key: string]: User } = {};

  for (const s of studentsData) {
    let studentUser = await usersRepo.findOne({ where: { email: s.email } });
    if (!studentUser) {
      studentUser = usersRepo.create({
        fullName: s.fullName,
        preferredName: s.preferredName,
        email: s.email,
        mobile: "0400 123 456",
        passwordHash: await hashPassword("Superadmin@123"),
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        employmentType: null,
        securitySetupComplete: true,
      });
      await usersRepo.save(studentUser);
      logger.info(`Seeded Student (${s.fullName})`);
    }
    studentsMap[s.email] = studentUser;
  }

  // 3. Seed Classes
  const classesData = [
    { name: "Biology Year 12", code: "BIO-12-B", room: "Room 4" },
    { name: "Chemistry Year 12", code: "CHE-12-A", room: "Room 2" },
    { name: "Maths Advanced", code: "MAT-09-C", room: "Room 1" },
  ];

  const classesMap: { [key: string]: Class } = {};

  for (const c of classesData) {
    let cls = await classesRepo.findOne({ where: { code: c.code } });
    if (!cls) {
      cls = classesRepo.create({
        name: c.name,
        code: c.code,
        room: c.room,
        teacher: teacher,
      });
      await classesRepo.save(cls);
      logger.info(`Seeded Class (${c.code})`);
    }
    classesMap[c.code] = cls;
  }

  // 4. Enroll Students in Biology BIO-12-B
  const bioClass = classesMap["BIO-12-B"];
  if (bioClass) {
    for (const email of Object.keys(studentsMap)) {
      const student = studentsMap[email];
      const hasEnrolment = await enrolmentsRepo.findOne({
        where: { classId: bioClass.id, studentId: student.id },
      });
      if (!hasEnrolment) {
        const enrolment = enrolmentsRepo.create({
          classId: bioClass.id,
          studentId: student.id,
        });
        await enrolmentsRepo.save(enrolment);
      }
    }
  }

  // 5. Enroll student Jayden in Chemistry CHE-12-A
  const chemClass = classesMap["CHE-12-A"];
  if (chemClass && studentsMap["jayden@example.com"]) {
    const student = studentsMap["jayden@example.com"];
    const hasEnrolment = await enrolmentsRepo.findOne({
      where: { classId: chemClass.id, studentId: student.id },
    });
    if (!hasEnrolment) {
      const enrolment = enrolmentsRepo.create({
        classId: chemClass.id,
        studentId: student.id,
      });
      await enrolmentsRepo.save(enrolment);
    }
  }

  // 6. Enroll student Sami in Maths Advanced MAT-09-C
  const mathClass = classesMap["MAT-09-C"];
  if (mathClass && studentsMap["sami@example.com"]) {
    const student = studentsMap["sami@example.com"];
    const hasEnrolment = await enrolmentsRepo.findOne({
      where: { classId: mathClass.id, studentId: student.id },
    });
    if (!hasEnrolment) {
      const enrolment = enrolmentsRepo.create({
        classId: mathClass.id,
        studentId: student.id,
      });
      await enrolmentsRepo.save(enrolment);
    }
  }

  // 7. Seed Sessions — start two hours ago so the grace window is already closed.
  const sessionStart = new Date();
  sessionStart.setHours(sessionStart.getHours() - 2, 0, 0, 0);
  const sessionEnd = new Date(sessionStart);
  sessionEnd.setHours(sessionEnd.getHours() + 1);

  // Bio session
  let bioSession = await sessionsRepo.findOne({
    where: { classId: bioClass.id },
  });

  if (!bioSession) {
    bioSession = sessionsRepo.create({
      classId: bioClass.id,
      startAt: sessionStart,
      endAt: sessionEnd,
      room: "Room 4",
      gracePeriodMinutes: 25,
    });
  } else {
    bioSession.startAt = sessionStart;
    bioSession.endAt = sessionEnd;
    bioSession.room = "Room 4";
    bioSession.gracePeriodMinutes = 25;
  }

  bioSession = await sessionsRepo.save(bioSession);

  logger.info("Biology session set with closed grace window");

  // Chem session
  let chemSession = await sessionsRepo.findOne({
    where: { classId: chemClass.id },
  });
  if (!chemSession) {
    chemSession = sessionsRepo.create({
      classId: chemClass.id,
      startAt: sessionStart,
      endAt: sessionEnd,
      room: "Room 2",
      gracePeriodMinutes: 25,
    });
  } else {
    chemSession.startAt = sessionStart;
    chemSession.endAt = sessionEnd;
    chemSession.gracePeriodMinutes = 25;
  }
  chemSession = await sessionsRepo.save(chemSession);

  // Math session
  let mathSession = await sessionsRepo.findOne({
    where: { classId: mathClass.id },
  });
  if (!mathSession) {
    mathSession = sessionsRepo.create({
      classId: mathClass.id,
      startAt: sessionStart,
      endAt: sessionEnd,
      room: "Room 1",
      gracePeriodMinutes: 25,
    });
  } else {
    mathSession.startAt = sessionStart;
    mathSession.endAt = sessionEnd;
    mathSession.gracePeriodMinutes = 25;
  }
  mathSession = await sessionsRepo.save(mathSession);

  // 8. Seed Valid/Manual Attendance Records (BIO-12-B)
  const studentsToMarkPresent = [
    "mia@example.com",
    "leo@example.com",
    "priya@example.com",
    "noah@example.com",
  ];
  for (const email of studentsToMarkPresent) {
    const student = studentsMap[email];
    if (student) {
      const hasRecord = await attendanceRepo.findOne({
        where: { sessionId: bioSession.id, studentId: student.id },
      });
      if (!hasRecord) {
        const timeScanned = new Date(sessionStart);
        if (email === "mia@example.com") timeScanned.setMinutes(0, 41);
        if (email === "leo@example.com") timeScanned.setMinutes(1, 12);
        if (email === "priya@example.com") timeScanned.setMinutes(-1, 52);
        if (email === "noah@example.com") timeScanned.setMinutes(2, 30);

        const isLate = timeScanned.getTime() > sessionStart.getTime();
        const record = attendanceRepo.create({
          sessionId: bioSession.id,
          studentId: student.id,
          status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          scannedAt: timeScanned,
        });
        await attendanceRepo.save(record);
      }
    }
  }

  // 9. Seed pending ScanExceptions in ScanEvent matching S7 Console
  const pendingExceptions = [
    {
      email: "jayden@example.com",
      session: chemSession,
      scannedAtOffsetMin: 31, // Scanned 16:31
      deviceSignal: "wifi - same LAN",
      reasonFlagged: ScanFlagReason.TOKEN_EXPIRED,
    },
    {
      email: "ivy@example.com",
      session: bioSession,
      scannedAtOffsetMin: 2, // Scanned 16:02
      deviceSignal: "already present",
      reasonFlagged: ScanFlagReason.DUPLICATE_SCAN,
    },
    {
      email: "ethan@example.com",
      session: bioSession,
      scannedAtOffsetMin: 4, // Scanned 16:04
      deviceSignal: "mobile · 14 km away",
      reasonFlagged: ScanFlagReason.OFF_NETWORK,
    },
    {
      email: "ruby@example.com",
      session: bioSession,
      scannedAtOffsetMin: -32, // Scanned 15:28 for 16:00 start (which was before start)
      deviceSignal: "wifi · same LAN",
      reasonFlagged: ScanFlagReason.TOKEN_EXPIRED,
    },
    {
      email: "lucas@example.com",
      session: bioSession,
      scannedAtOffsetMin: 9, // Scanned 16:09, synced 16:23
      deviceSignal: "queued on device",
      reasonFlagged: ScanFlagReason.NONE,
      isOfflineSync: true,
    },
    {
      email: "sami@example.com",
      session: mathSession,
      scannedAtOffsetMin: 33, // Scanned 16:33
      deviceSignal: "scanned MAT-10-A",
      reasonFlagged: ScanFlagReason.WRONG_SESSION_CODE,
    },
  ];

  for (const ex of pendingExceptions) {
    const student = studentsMap[ex.email];
    if (student && ex.session) {
      const hasScan = await scansRepo.findOne({
        where: {
          sessionId: ex.session.id,
          studentId: student.id,
          status: ScanStatus.PENDING,
        },
      });
      if (!hasScan) {
        const scanTime = new Date(sessionStart);
        scanTime.setMinutes(sessionStart.getMinutes() + ex.scannedAtOffsetMin);

        const syncTime = new Date(scanTime);
        if (ex.isOfflineSync) {
          syncTime.setMinutes(23); // Synced at 16:23
        } else {
          syncTime.setSeconds(syncTime.getSeconds() + 2); // Synced immediately
        }

        const scan = scansRepo.create({
          studentId: student.id,
          sessionId: ex.session.id,
          scannedAt: scanTime,
          syncedAt: syncTime,
          scannedCode:
            ex.reasonFlagged === ScanFlagReason.WRONG_SESSION_CODE
              ? "MAT-10-A-code"
              : "BIO-12-B-code",
          deviceSignal: ex.deviceSignal,
          isOfflineSync: !!ex.isOfflineSync,
          status: ScanStatus.PENDING,
          reasonFlagged: ex.reasonFlagged,
        });
        await scansRepo.save(scan);
      }
    }
  }

  logger.info("Database seed completion verified.");
}
