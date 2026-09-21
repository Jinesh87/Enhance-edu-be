import { In, IsNull, LessThan, MoreThan, Not, type FindOptionsWhere } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  ChatConversation,
  ChatMessage,
  User,
} from "../../../entities/index.js";
import {
  assertCanChat,
  assertGuardianAdminChatEnabled,
  assertGuardianTeacherChatEnabled,
  assertOfficeAdminChatEnabled,
  assertOfficeStaffChatEnabled,
  assertOfficeTeacherChatEnabled,
  assertStudentAdminChatEnabled,
  assertTeacherAdminChatEnabled,
  assertTeacherTeacherChatEnabled,
  isAdminChatRole,
  isGuardianAdminConversation,
  isGuardianTeacherConversation,
  isOfficeAdminConversation,
  isOfficeStaffPeerConversation,
  isOfficeTeacherConversation,
  isStudentAdminConversation,
  isTeacherAdminConversation,
  isTeacherTeacherConversation,
  listAdminsForGuardian,
  listGuardiansForAdmin,
  listGuardiansForTeacher,
  listOfficeStaffForOfficeStaff,
  listOfficeStaffForSuperAdmin,
  listOfficeStaffForTeacher,
  listStudentsForSuperAdmin,
  listStudentsForTeacher,
  listSuperAdminsForOfficeStaff,
  listSuperAdminsForStudent,
  listSuperAdminsForTeacher,
  listTeachersForGuardian,
  listTeachersForOfficeStaff,
  listTeachersForStudent,
  listTeachersForSuperAdmin,
  listTeachersForTeacher,
  peerDisplayName,
  type ChatPeer,
} from "./chat-auth.js";
import { emitToUser, isUserOnline, isUserViewingConversation } from "./chat-socket.js";
import {
  buildChatImageKey,
  deleteObject,
  getObjectBuffer,
  putObject,
  storeUploadedObject,
  type IncomingStoredFile,
} from "../../../common/storage/object-storage.js";
import { assertValidChatAttachmentBuffer, isChatAttachmentMime, isChatAudioMime, isChatDocumentMime, isChatImageMime } from "../../../common/validation/validate-upload.js";
import { notifyUsers } from "../../notifications/domain-notifications.js";
import { settingsService } from "../../settings/settings.service.js";
import { logger } from "../../../config/logger.js";
import sharp from "sharp";

const MESSAGE_PAGE_SIZE = 50;
const MAX_BODY_LENGTH = 4000;
const CHAT_THUMB_MAX_EDGE = 480;
const CHAT_THUMB_WEBP_QUALITY = 70;

async function createAndStoreChatThumbnail(params: {
  conversationId: string;
  messageId: string;
  sourceBuffer?: Buffer;
  sourceStorageKey: string;
}): Promise<string | null> {
  try {
    const source =
      params.sourceBuffer && params.sourceBuffer.length > 0
        ? params.sourceBuffer
        : await getObjectBuffer(params.sourceStorageKey);
    const thumbBuffer = await sharp(source)
      .rotate()
      .resize(CHAT_THUMB_MAX_EDGE, CHAT_THUMB_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: CHAT_THUMB_WEBP_QUALITY })
      .toBuffer();
    const thumbKey = buildChatImageKey({
      conversationId: params.conversationId,
      messageId: params.messageId,
      fileName: "thumb.webp",
    });
    await putObject({
      key: thumbKey,
      body: thumbBuffer,
      contentType: "image/webp",
    });
    return thumbKey;
  } catch (error) {
    logger.warn(
      { err: error, messageId: params.messageId },
      "Failed to create chat image thumbnail",
    );
    return null;
  }
}

async function assertChatRole(role: UserRole) {
  if (role === UserRole.STUDENT || role === UserRole.STAFF) return;
  if (role === UserRole.GUARDIAN) {
    const [teacherChat, adminChat] = await Promise.all([
      settingsService.isGuardianTeacherChatEnabled(),
      settingsService.isGuardianAdminChatEnabled(),
    ]);
    if (!teacherChat && !adminChat) {
      throw new AppError(
        403,
        "Guardian chat is not enabled",
        "CHAT_DISABLED",
      );
    }
    return;
  }
  if (isAdminChatRole(role)) {
    const [guardianAdmin, studentAdmin, teacherAdmin, officeAdmin] =
      await Promise.all([
        settingsService.isGuardianAdminChatEnabled(),
        settingsService.isStudentAdminChatEnabled(),
        settingsService.isTeacherAdminChatEnabled(),
        settingsService.isOfficeAdminChatEnabled(),
      ]);
    if (!guardianAdmin && !studentAdmin && !teacherAdmin && !officeAdmin) {
      throw new AppError(
        403,
        "Admin chat is not enabled",
        "CHAT_DISABLED",
      );
    }
    return;
  }
  if (role === UserRole.OFFICE_STAFF) {
    const [officeStaff, officeTeacher, officeAdmin] = await Promise.all([
      settingsService.isOfficeStaffChatEnabled(),
      settingsService.isOfficeTeacherChatEnabled(),
      settingsService.isOfficeAdminChatEnabled(),
    ]);
    if (!officeStaff && !officeTeacher && !officeAdmin) {
      throw new AppError(
        403,
        "Office staff chat is not enabled",
        "CHAT_DISABLED",
      );
    }
    return;
  }
  throw new AppError(
    403,
    "Chat is not available for this role",
    "CHAT_FORBIDDEN",
  );
}

function chatNotificationHref(
  conversation: ChatConversation,
  recipientUserId: string,
) {
  if (isGuardianAdminConversation(conversation)) {
    return conversation.guardianUserId === recipientUserId
      ? `/guardian/messages/${conversation.id}`
      : `/admin/messages/${conversation.id}`;
  }
  if (isStudentAdminConversation(conversation)) {
    return conversation.studentUserId === recipientUserId
      ? `/student/messages/${conversation.id}`
      : `/admin/messages/${conversation.id}`;
  }
  if (isOfficeTeacherConversation(conversation)) {
    return conversation.adminUserId === recipientUserId
      ? `/admin/messages/${conversation.id}`
      : `/tutor/messages/${conversation.id}`;
  }
  if (isOfficeAdminConversation(conversation)) {
    return `/admin/messages/${conversation.id}`;
  }
  if (isTeacherAdminConversation(conversation)) {
    return conversation.adminUserId === recipientUserId
      ? `/admin/messages/${conversation.id}`
      : `/tutor/messages/${conversation.id}`;
  }
  if (isOfficeStaffPeerConversation(conversation)) {
    return `/admin/messages/${conversation.id}`;
  }
  if (isGuardianTeacherConversation(conversation)) {
    return conversation.guardianUserId === recipientUserId
      ? `/guardian/messages/${conversation.id}`
      : `/tutor/messages/${conversation.id}`;
  }
  if (isTeacherTeacherConversation(conversation)) {
    return `/tutor/messages/${conversation.id}`;
  }
  return conversation.studentUserId === recipientUserId
    ? `/student/messages/${conversation.id}`
    : `/tutor/messages/${conversation.id}`;
}

export type ChatReplyPreviewDto = {
  id: string;
  senderUserId: string;
  body: string;
  hasImage: boolean;
  image: {
    originalName: string;
    mimeType: string;
    byteSize: number;
  } | null;
  deletedAt: string | null;
};

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  hasImage: boolean;
  hasThumbnail: boolean;
  image: {
    originalName: string;
    mimeType: string;
    byteSize: number;
  } | null;
  deliveredAt: string | null;
  readAt: string | null;
  voicePlayedAt: string | null;
  deletedAt: string | null;
  editedAt: string | null;
  replyToMessageId: string | null;
  replyTo: ChatReplyPreviewDto | null;
  createdAt: string;
  status: "sent" | "delivered" | "read";
};

function messageStatus(message: ChatMessage): ChatMessageDto["status"] {
  if (message.readAt) return "read";
  if (message.deliveredAt) return "delivered";
  return "sent";
}

function messagePreview(message: ChatMessage | null | undefined): string | null {
  if (!message) return null;
  if (message.deletedAt) return "Message deleted";
  const body = message.body?.trim() ?? "";
  if (body) return body.slice(0, 160);
  if (message.storageKey) {
    if (message.mimeType && isChatImageMime(message.mimeType)) return "Photo";
    if (message.mimeType && isChatAudioMime(message.mimeType)) {
      return "Voice message";
    }
    return "Document";
  }
  return null;
}

function toReplyPreviewDto(message: ChatMessage): ChatReplyPreviewDto {
  const deleted = Boolean(message.deletedAt);
  const hasImage = !deleted && Boolean(message.storageKey);
  return {
    id: message.id,
    senderUserId: message.senderUserId,
    body: deleted ? "" : (message.body ?? "").slice(0, 160),
    hasImage,
    image:
      hasImage && message.originalName && message.mimeType
        ? {
            originalName: message.originalName,
            mimeType: message.mimeType,
            byteSize: message.byteSize ?? 0,
          }
        : null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

function toMessageDto(
  message: ChatMessage,
  replyTo?: ChatMessage | null,
): ChatMessageDto {
  const deleted = Boolean(message.deletedAt);
  const hasImage = !deleted && Boolean(message.storageKey);
  const replyToMessageId = message.replyToMessageId ?? null;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    body: deleted ? "" : message.body,
    hasImage,
    hasThumbnail: hasImage && Boolean(message.thumbnailStorageKey),
    image:
      hasImage && message.originalName && message.mimeType
        ? {
            originalName: message.originalName,
            mimeType: message.mimeType,
            byteSize: message.byteSize ?? 0,
          }
        : null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
    voicePlayedAt: message.voicePlayedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    editedAt: message.editedAt?.toISOString() ?? null,
    replyToMessageId,
    replyTo:
      replyToMessageId == null
        ? null
        : replyTo
          ? toReplyPreviewDto(replyTo)
          : {
              id: replyToMessageId,
              senderUserId: "",
              body: "",
              hasImage: false,
              image: null,
              deletedAt: new Date(0).toISOString(),
            },
    createdAt: message.createdAt.toISOString(),
    status: messageStatus(message),
  };
}

export class ChatService {
  private readonly conversations =
    AppDataSource.getRepository(ChatConversation);
  private readonly messages = AppDataSource.getRepository(ChatMessage);
  private readonly users = AppDataSource.getRepository(User);

  private async toMessageDtos(messages: ChatMessage[]): Promise<ChatMessageDto[]> {
    const replyIds = [
      ...new Set(
        messages
          .map((row) => row.replyToMessageId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const replies =
      replyIds.length > 0
        ? await this.messages.find({ where: { id: In(replyIds) } })
        : [];
    const replyById = new Map(replies.map((row) => [row.id, row]));
    return messages.map((row) =>
      toMessageDto(
        row,
        row.replyToMessageId ? replyById.get(row.replyToMessageId) ?? null : null,
      ),
    );
  }

  async listContacts(userId: string, role: UserRole) {
    await assertChatRole(role);

    let contacts: ChatPeer[] = [];
    if (role === UserRole.STUDENT) {
      contacts = await listTeachersForStudent(userId);
      if (await settingsService.isStudentAdminChatEnabled()) {
        contacts = [...contacts, ...(await listSuperAdminsForStudent(userId))];
      }
    } else if (role === UserRole.GUARDIAN) {
      if (await settingsService.isGuardianTeacherChatEnabled()) {
        contacts = await listTeachersForGuardian(userId);
      }
      if (await settingsService.isGuardianAdminChatEnabled()) {
        contacts = [...contacts, ...(await listAdminsForGuardian(userId))];
      }
    } else if (role === UserRole.STAFF) {
      contacts = await listStudentsForTeacher(userId);
      if (await settingsService.isGuardianTeacherChatEnabled()) {
        contacts = [...contacts, ...(await listGuardiansForTeacher(userId))];
      }
      if (await settingsService.isTeacherTeacherChatEnabled()) {
        contacts = [...contacts, ...(await listTeachersForTeacher(userId))];
      }
      if (await settingsService.isOfficeTeacherChatEnabled()) {
        contacts = [...contacts, ...(await listOfficeStaffForTeacher(userId))];
      }
      if (await settingsService.isTeacherAdminChatEnabled()) {
        contacts = [...contacts, ...(await listSuperAdminsForTeacher(userId))];
      }
    } else if (role === UserRole.OFFICE_STAFF) {
      if (await settingsService.isOfficeStaffChatEnabled()) {
        contacts = await listOfficeStaffForOfficeStaff(userId);
      }
      if (await settingsService.isOfficeTeacherChatEnabled()) {
        contacts = [
          ...contacts,
          ...(await listTeachersForOfficeStaff(userId)),
        ];
      }
      if (await settingsService.isOfficeAdminChatEnabled()) {
        contacts = [
          ...contacts,
          ...(await listSuperAdminsForOfficeStaff(userId)),
        ];
      }
    } else if (isAdminChatRole(role)) {
      if (await settingsService.isGuardianAdminChatEnabled()) {
        contacts = await listGuardiansForAdmin(userId);
      }
      if (await settingsService.isStudentAdminChatEnabled()) {
        contacts = [
          ...contacts,
          ...(await listStudentsForSuperAdmin(userId)),
        ];
      }
      if (await settingsService.isTeacherAdminChatEnabled()) {
        contacts = [
          ...contacts,
          ...(await listTeachersForSuperAdmin(userId)),
        ];
      }
      if (await settingsService.isOfficeAdminChatEnabled()) {
        contacts = [
          ...contacts,
          ...(await listOfficeStaffForSuperAdmin(userId)),
        ];
      }
    }

    return {
      contacts: contacts.map((peer) => ({
        userId: peer.userId,
        name: peerDisplayName(peer),
        fullName: peer.fullName,
        preferredName: peer.preferredName,
        role: peer.role,
        sharedClasses: peer.sharedClasses,
        subtitle: peer.subtitle ?? null,
        online: isUserOnline(peer.userId),
      })),
    };
  }

  private async unreadCountForUser(
    userId: string,
    conversationId?: string,
  ): Promise<number> {
    const qb = this.messages
      .createQueryBuilder("message")
      .innerJoin("message.conversation", "conversation")
      .where("message.senderUserId != :userId", { userId })
      .andWhere("message.readAt IS NULL")
      .andWhere("message.deletedAt IS NULL")
      .andWhere(
        "(conversation.studentUserId = :userId OR conversation.teacherUserId = :userId OR conversation.guardianUserId = :userId OR conversation.peerTeacherUserId = :userId OR conversation.adminUserId = :userId)",
        { userId },
      )
      .andWhere(
        `(
          (conversation.studentUserId = :userId AND (conversation.studentClearedAt IS NULL OR message.createdAt > conversation.studentClearedAt))
          OR (conversation.teacherUserId = :userId AND (conversation.teacherClearedAt IS NULL OR message.createdAt > conversation.teacherClearedAt))
          OR (conversation.guardianUserId = :userId AND (conversation.guardianClearedAt IS NULL OR message.createdAt > conversation.guardianClearedAt))
          OR (conversation.peerTeacherUserId = :userId AND (conversation.peerTeacherClearedAt IS NULL OR message.createdAt > conversation.peerTeacherClearedAt))
          OR (conversation.adminUserId = :userId AND (conversation.adminClearedAt IS NULL OR message.createdAt > conversation.adminClearedAt))
        )`,
        { userId },
      );

    if (conversationId) {
      qb.andWhere("message.conversationId = :conversationId", {
        conversationId,
      });
    }

    return qb.getCount();
  }

  private peerUserId(conversation: ChatConversation, viewerUserId: string) {
    if (isGuardianAdminConversation(conversation)) {
      return conversation.guardianUserId === viewerUserId
        ? conversation.adminUserId!
        : conversation.guardianUserId!;
    }
    if (isStudentAdminConversation(conversation)) {
      return conversation.studentUserId === viewerUserId
        ? conversation.adminUserId!
        : conversation.studentUserId!;
    }
    if (
      isOfficeTeacherConversation(conversation) ||
      isOfficeAdminConversation(conversation) ||
      isTeacherAdminConversation(conversation)
    ) {
      return conversation.teacherUserId === viewerUserId
        ? conversation.adminUserId!
        : conversation.teacherUserId!;
    }
    if (
      isTeacherTeacherConversation(conversation) ||
      isOfficeStaffPeerConversation(conversation)
    ) {
      return conversation.teacherUserId === viewerUserId
        ? conversation.peerTeacherUserId!
        : conversation.teacherUserId!;
    }
    if (isGuardianTeacherConversation(conversation)) {
      return conversation.guardianUserId === viewerUserId
        ? conversation.teacherUserId!
        : conversation.guardianUserId!;
    }
    return conversation.studentUserId === viewerUserId
      ? conversation.teacherUserId!
      : conversation.studentUserId!;
  }

  private isMutedForUser(
    conversation: ChatConversation,
    viewerUserId: string,
  ) {
    if (conversation.adminUserId === viewerUserId) {
      return Boolean(conversation.adminMutedAt);
    }
    if (conversation.peerTeacherUserId === viewerUserId) {
      return Boolean(conversation.peerTeacherMutedAt);
    }
    if (conversation.guardianUserId === viewerUserId) {
      return Boolean(conversation.guardianMutedAt);
    }
    if (conversation.studentUserId === viewerUserId) {
      return Boolean(conversation.studentMutedAt);
    }
    return Boolean(conversation.teacherMutedAt);
  }

  private clearedAtForUser(
    conversation: ChatConversation,
    viewerUserId: string,
  ): Date | null {
    if (conversation.adminUserId === viewerUserId) {
      return conversation.adminClearedAt ?? null;
    }
    if (conversation.peerTeacherUserId === viewerUserId) {
      return conversation.peerTeacherClearedAt ?? null;
    }
    if (conversation.guardianUserId === viewerUserId) {
      return conversation.guardianClearedAt ?? null;
    }
    if (conversation.studentUserId === viewerUserId) {
      return conversation.studentClearedAt ?? null;
    }
    return conversation.teacherClearedAt ?? null;
  }

  private setClearedAtForUser(
    conversation: ChatConversation,
    viewerUserId: string,
    at: Date,
  ) {
    if (conversation.adminUserId === viewerUserId) {
      conversation.adminClearedAt = at;
    } else if (conversation.peerTeacherUserId === viewerUserId) {
      conversation.peerTeacherClearedAt = at;
    } else if (conversation.guardianUserId === viewerUserId) {
      conversation.guardianClearedAt = at;
    } else if (conversation.studentUserId === viewerUserId) {
      conversation.studentClearedAt = at;
    } else {
      conversation.teacherClearedAt = at;
    }
  }

  private async toConversationDto(
    conversation: ChatConversation,
    viewerUserId: string,
    peer?: ChatPeer | User | null,
    lastMessage?: ChatMessage | null,
  ) {
    const peerId = this.peerUserId(conversation, viewerUserId);
    let peerName = "Chat";
    let peerSubtitle: string | null = null;
    let peerRole: string | null = null;
    if (peer && "fullName" in peer) {
      peerName = peerDisplayName({
        fullName: peer.fullName,
        preferredName:
          "preferredName" in peer
            ? ((peer as User).preferredName ?? null)
            : null,
      });
      if ("subtitle" in peer && peer.subtitle) {
        peerSubtitle = peer.subtitle;
      }
      if ("role" in peer && peer.role) {
        peerRole = String(peer.role);
      }
    }
    if (!peerRole) {
      if (isGuardianAdminConversation(conversation)) {
        peerRole =
          conversation.guardianUserId === peerId
            ? UserRole.GUARDIAN
            : UserRole.SUPER_ADMIN;
      } else if (isStudentAdminConversation(conversation)) {
        peerRole =
          conversation.studentUserId === peerId
            ? UserRole.STUDENT
            : UserRole.SUPER_ADMIN;
      } else if (isOfficeTeacherConversation(conversation)) {
        peerRole =
          conversation.teacherUserId === peerId
            ? UserRole.STAFF
            : UserRole.OFFICE_STAFF;
      } else if (isOfficeAdminConversation(conversation)) {
        peerRole =
          conversation.teacherUserId === peerId
            ? UserRole.OFFICE_STAFF
            : UserRole.SUPER_ADMIN;
      } else if (isTeacherAdminConversation(conversation)) {
        peerRole =
          conversation.teacherUserId === peerId
            ? UserRole.STAFF
            : UserRole.SUPER_ADMIN;
      } else if (isTeacherTeacherConversation(conversation)) {
        peerRole = UserRole.STAFF;
      } else if (isOfficeStaffPeerConversation(conversation)) {
        peerRole = UserRole.OFFICE_STAFF;
      } else if (isGuardianTeacherConversation(conversation)) {
        peerRole =
          conversation.guardianUserId === peerId
            ? UserRole.GUARDIAN
            : UserRole.STAFF;
      } else {
        peerRole =
          conversation.studentUserId === peerId
            ? UserRole.STUDENT
            : UserRole.STAFF;
      }
    }
    if (!peerSubtitle && peerRole === UserRole.GUARDIAN) {
      peerSubtitle = "Guardian";
    }
    if (!peerSubtitle && isTeacherTeacherConversation(conversation)) {
      peerSubtitle = "Teacher";
    }
    if (!peerSubtitle && isOfficeStaffPeerConversation(conversation)) {
      peerSubtitle = "Office Staff";
    }
    if (!peerSubtitle && isGuardianAdminConversation(conversation)) {
      if (conversation.guardianUserId === peerId) {
        peerSubtitle = "Guardian";
      } else {
        peerSubtitle = "Super Admin";
      }
    }
    if (!peerSubtitle && isStudentAdminConversation(conversation)) {
      peerSubtitle =
        conversation.studentUserId === peerId ? "Student" : "Super Admin";
    }
    if (!peerSubtitle && isOfficeTeacherConversation(conversation)) {
      peerSubtitle =
        conversation.teacherUserId === peerId ? "Teacher" : "Office Staff";
    }
    if (!peerSubtitle && isOfficeAdminConversation(conversation)) {
      peerSubtitle =
        conversation.teacherUserId === peerId
          ? "Office Staff"
          : "Super Admin";
    }
    if (!peerSubtitle && isTeacherAdminConversation(conversation)) {
      peerSubtitle =
        conversation.teacherUserId === peerId ? "Teacher" : "Super Admin";
    }

    const unreadCount = await this.unreadCountForUser(
      viewerUserId,
      conversation.id,
    );

    return {
      id: conversation.id,
      kind: isGuardianAdminConversation(conversation)
        ? ("GUARDIAN_ADMIN" as const)
        : isStudentAdminConversation(conversation)
          ? ("STUDENT_ADMIN" as const)
          : isOfficeTeacherConversation(conversation)
            ? ("OFFICE_TEACHER" as const)
            : isOfficeAdminConversation(conversation)
              ? ("OFFICE_ADMIN" as const)
              : isTeacherAdminConversation(conversation)
                ? ("TEACHER_ADMIN" as const)
                : isOfficeStaffPeerConversation(conversation)
                  ? ("OFFICE_STAFF_OFFICE_STAFF" as const)
                  : isTeacherTeacherConversation(conversation)
                    ? ("TEACHER_TEACHER" as const)
                    : isGuardianTeacherConversation(conversation)
                      ? ("GUARDIAN_TEACHER" as const)
                      : ("STUDENT_TEACHER" as const),
      peerUserId: peerId,
      peerName,
      peerRole,
      peerSubtitle,
      peerOnline: isUserOnline(peerId),
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: messagePreview(lastMessage),
      lastMessageStatus: lastMessage
        ? messageStatus(lastMessage)
        : null,
      lastMessageMine: lastMessage
        ? lastMessage.senderUserId === viewerUserId
        : false,
      unreadCount,
      muted: this.isMutedForUser(conversation, viewerUserId),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  async listConversations(userId: string, role: UserRole) {
    await assertChatRole(role);

    const where =
      role === UserRole.STUDENT
        ? { studentUserId: userId, lastMessageAt: Not(IsNull()) }
        : role === UserRole.GUARDIAN
          ? { guardianUserId: userId, lastMessageAt: Not(IsNull()) }
          : isAdminChatRole(role)
            ? { adminUserId: userId, lastMessageAt: Not(IsNull()) }
            : role === UserRole.OFFICE_STAFF
              ? [
                  {
                    kind: "OFFICE_STAFF_OFFICE_STAFF" as const,
                    teacherUserId: userId,
                    lastMessageAt: Not(IsNull()),
                  },
                  {
                    kind: "OFFICE_STAFF_OFFICE_STAFF" as const,
                    peerTeacherUserId: userId,
                    lastMessageAt: Not(IsNull()),
                  },
                  {
                    kind: "OFFICE_TEACHER" as const,
                    adminUserId: userId,
                    lastMessageAt: Not(IsNull()),
                  },
                  {
                    kind: "OFFICE_ADMIN" as const,
                    teacherUserId: userId,
                    lastMessageAt: Not(IsNull()),
                  },
                ]
              : [
                  { teacherUserId: userId, lastMessageAt: Not(IsNull()) },
                  { peerTeacherUserId: userId, lastMessageAt: Not(IsNull()) },
                ];

    let conversations = await this.conversations.find({
      where,
      order: { lastMessageAt: "DESC", updatedAt: "DESC" },
      take: 100,
    });

    if (role === UserRole.STUDENT) {
      if (!(await settingsService.isStudentAdminChatEnabled())) {
        conversations = conversations.filter(
          (row) => !isStudentAdminConversation(row),
        );
      }
    }

    if (role === UserRole.GUARDIAN) {
      const [teacherChat, adminChat] = await Promise.all([
        settingsService.isGuardianTeacherChatEnabled(),
        settingsService.isGuardianAdminChatEnabled(),
      ]);
      if (!teacherChat) {
        conversations = conversations.filter(
          (row) => !isGuardianTeacherConversation(row),
        );
      }
      if (!adminChat) {
        conversations = conversations.filter(
          (row) => !isGuardianAdminConversation(row),
        );
      }
    }

    if (isAdminChatRole(role)) {
      const [guardianAdmin, studentAdmin, teacherAdmin, officeAdmin] =
        await Promise.all([
          settingsService.isGuardianAdminChatEnabled(),
          settingsService.isStudentAdminChatEnabled(),
          settingsService.isTeacherAdminChatEnabled(),
          settingsService.isOfficeAdminChatEnabled(),
        ]);
      if (!guardianAdmin) {
        conversations = conversations.filter(
          (row) => !isGuardianAdminConversation(row),
        );
      }
      if (!studentAdmin) {
        conversations = conversations.filter(
          (row) => !isStudentAdminConversation(row),
        );
      }
      if (!teacherAdmin) {
        conversations = conversations.filter(
          (row) => !isTeacherAdminConversation(row),
        );
      }
      if (!officeAdmin) {
        conversations = conversations.filter(
          (row) => !isOfficeAdminConversation(row),
        );
      }
    }

    if (role === UserRole.OFFICE_STAFF) {
      const [officeStaff, officeTeacher, officeAdmin] = await Promise.all([
        settingsService.isOfficeStaffChatEnabled(),
        settingsService.isOfficeTeacherChatEnabled(),
        settingsService.isOfficeAdminChatEnabled(),
      ]);
      if (!officeStaff) {
        conversations = conversations.filter(
          (row) => !isOfficeStaffPeerConversation(row),
        );
      }
      if (!officeTeacher) {
        conversations = conversations.filter(
          (row) => !isOfficeTeacherConversation(row),
        );
      }
      if (!officeAdmin) {
        conversations = conversations.filter(
          (row) => !isOfficeAdminConversation(row),
        );
      }
    }

    if (role === UserRole.STAFF) {
      const [
        guardianEnabled,
        teacherPeerEnabled,
        officeTeacherEnabled,
        teacherAdminEnabled,
      ] = await Promise.all([
        settingsService.isGuardianTeacherChatEnabled(),
        settingsService.isTeacherTeacherChatEnabled(),
        settingsService.isOfficeTeacherChatEnabled(),
        settingsService.isTeacherAdminChatEnabled(),
      ]);
      if (!guardianEnabled) {
        conversations = conversations.filter(
          (row) => !isGuardianTeacherConversation(row),
        );
      }
      if (!teacherPeerEnabled) {
        conversations = conversations.filter(
          (row) => !isTeacherTeacherConversation(row),
        );
      }
      if (!officeTeacherEnabled) {
        conversations = conversations.filter(
          (row) => !isOfficeTeacherConversation(row),
        );
      }
      if (!teacherAdminEnabled) {
        conversations = conversations.filter(
          (row) => !isTeacherAdminConversation(row),
        );
      }

      if (conversations.length === 0) {
        return {
          conversations: [] as Awaited<
            ReturnType<typeof this.toConversationDto>
          >[],
        };
      }

      const peerIds = conversations.map((row) => this.peerUserId(row, userId));
      const peers = await this.users.find({
        where: { id: In(peerIds) },
        select: { id: true, fullName: true, preferredName: true, role: true },
      });
      const peerById = new Map(peers.map((peer) => [peer.id, peer]));

      const [guardians, teachers, officeStaff, admins] = await Promise.all([
        guardianEnabled
          ? listGuardiansForTeacher(userId)
          : Promise.resolve([] as ChatPeer[]),
        teacherPeerEnabled
          ? listTeachersForTeacher(userId)
          : Promise.resolve([] as ChatPeer[]),
        officeTeacherEnabled
          ? listOfficeStaffForTeacher(userId)
          : Promise.resolve([] as ChatPeer[]),
        teacherAdminEnabled
          ? listSuperAdminsForTeacher(userId)
          : Promise.resolve([] as ChatPeer[]),
      ]);
      const peerSubtitles = new Map(
        [...guardians, ...teachers, ...officeStaff, ...admins]
          .filter((row) => row.subtitle)
          .map((row) => [row.userId, row.subtitle!]),
      );

      const lastMessages = await this.messages
        .createQueryBuilder("message")
        .distinctOn(["message.conversationId"])
        .where("message.conversationId IN (:...ids)", {
          ids: conversations.map((row) => row.id),
        })
        .orderBy("message.conversationId")
        .addOrderBy("message.createdAt", "DESC")
        .getMany();
      const lastByConversation = new Map(
        lastMessages.map((message) => [message.conversationId, message]),
      );

      const dtos = await Promise.all(
        conversations.map(async (conversation) => {
          const peerId = this.peerUserId(conversation, userId);
          const peer = peerById.get(peerId) ?? null;
          const enriched = peer
            ? {
                ...peer,
                subtitle: peerSubtitles.get(peerId) ?? null,
              }
            : null;
          let last = lastByConversation.get(conversation.id) ?? null;
          const clearedAt = this.clearedAtForUser(conversation, userId);
          if (last && clearedAt && last.createdAt <= clearedAt) {
            last =
              (await this.messages.findOne({
                where: {
                  conversationId: conversation.id,
                  createdAt: MoreThan(clearedAt),
                },
                order: { createdAt: "DESC" },
              })) ?? null;
          }
          return this.toConversationDto(conversation, userId, enriched, last);
        }),
      );

      return { conversations: dtos };
    }

    if (conversations.length === 0) {
      return {
        conversations: [] as Awaited<
          ReturnType<typeof this.toConversationDto>
        >[],
      };
    }

    const peerIds = conversations.map((row) => this.peerUserId(row, userId));
    const peers = await this.users.find({
      where: { id: In(peerIds) },
      select: { id: true, fullName: true, preferredName: true, role: true },
    });
    const peerById = new Map(peers.map((peer) => [peer.id, peer]));

    const lastMessages = await this.messages
      .createQueryBuilder("message")
      .distinctOn(["message.conversationId"])
      .where("message.conversationId IN (:...ids)", {
        ids: conversations.map((row) => row.id),
      })
      .orderBy("message.conversationId")
      .addOrderBy("message.createdAt", "DESC")
      .getMany();
    const lastByConversation = new Map(
      lastMessages.map((message) => [message.conversationId, message]),
    );

    const dtos = await Promise.all(
      conversations.map(async (conversation) => {
        const peerId = this.peerUserId(conversation, userId);
        const peer = peerById.get(peerId) ?? null;
        let last = lastByConversation.get(conversation.id) ?? null;
        const clearedAt = this.clearedAtForUser(conversation, userId);
        if (last && clearedAt && last.createdAt <= clearedAt) {
          last =
            (await this.messages.findOne({
              where: {
                conversationId: conversation.id,
                createdAt: MoreThan(clearedAt),
              },
              order: { createdAt: "DESC" },
            })) ?? null;
        }
        return this.toConversationDto(conversation, userId, peer, last);
      }),
    );

    return { conversations: dtos };
  }

  async search(
    userId: string,
    role: UserRole,
    queryRaw: string,
  ) {
    const query = queryRaw.trim();
    if (query.length < 1) {
      return { conversations: [], contacts: [], messages: [] };
    }

    const [{ conversations }, { contacts }] = await Promise.all([
      this.listConversations(userId, role),
      this.listContacts(userId, role),
    ]);

    const needle = query.toLowerCase();
    const matchedConversations = conversations.filter(
      (row) =>
        row.peerName.toLowerCase().includes(needle) ||
        (row.lastMessagePreview ?? "").toLowerCase().includes(needle),
    );
    const matchedContacts = contacts.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.fullName.toLowerCase().includes(needle) ||
        row.sharedClasses.some(
          (cls) =>
            cls.className.toLowerCase().includes(needle) ||
            (cls.subject ?? "").toLowerCase().includes(needle),
        ),
    );

    const messageRows = await this.messages
      .createQueryBuilder("message")
      .innerJoinAndSelect("message.conversation", "conversation")
      .where(
        "(conversation.studentUserId = :userId OR conversation.teacherUserId = :userId OR conversation.guardianUserId = :userId OR conversation.peerTeacherUserId = :userId OR conversation.adminUserId = :userId)",
        { userId },
      )
      .andWhere("message.deletedAt IS NULL")
      .andWhere("message.body ILIKE :needle", { needle: `%${query}%` })
      .andWhere(
        `(
          (conversation.studentUserId = :userId AND (conversation.studentClearedAt IS NULL OR message.createdAt > conversation.studentClearedAt))
          OR (conversation.teacherUserId = :userId AND (conversation.teacherClearedAt IS NULL OR message.createdAt > conversation.teacherClearedAt))
          OR (conversation.guardianUserId = :userId AND (conversation.guardianClearedAt IS NULL OR message.createdAt > conversation.guardianClearedAt))
          OR (conversation.peerTeacherUserId = :userId AND (conversation.peerTeacherClearedAt IS NULL OR message.createdAt > conversation.peerTeacherClearedAt))
          OR (conversation.adminUserId = :userId AND (conversation.adminClearedAt IS NULL OR message.createdAt > conversation.adminClearedAt))
        )`,
        { userId },
      )
      .orderBy("message.createdAt", "DESC")
      .take(30)
      .getMany();

    const peerIds = [
      ...new Set(
        messageRows.map((row) =>
          this.peerUserId(row.conversation, userId),
        ),
      ),
    ];
    const peers =
      peerIds.length > 0
        ? await this.users.find({
            where: { id: In(peerIds) },
            select: { id: true, fullName: true, preferredName: true },
          })
        : [];
    const peerById = new Map(peers.map((peer) => [peer.id, peer]));
    const messageDtos = await this.toMessageDtos(messageRows);

    return {
      conversations: matchedConversations,
      contacts: matchedContacts,
      messages: messageDtos.map((dto, index) => {
        const row = messageRows[index]!;
        const peerId = this.peerUserId(row.conversation, userId);
        const peer = peerById.get(peerId);
        return {
          ...dto,
          conversationId: row.conversationId,
          peerUserId: peerId,
          peerName: peer
            ? peerDisplayName({
                fullName: peer.fullName,
                preferredName: peer.preferredName,
              })
            : "Chat",
        };
      }),
    };
  }

  async openConversation(
    userId: string,
    role: UserRole,
    peerUserId: string,
  ) {
    await assertChatRole(role);
    const pair = await assertCanChat(userId, role, peerUserId);

    let conversation =
      pair.kind === "GUARDIAN_TEACHER"
        ? await this.conversations.findOne({
            where: {
              kind: "GUARDIAN_TEACHER",
              guardianUserId: pair.guardianUserId,
              teacherUserId: pair.teacherUserId,
            },
          })
        : pair.kind === "TEACHER_TEACHER" ||
            pair.kind === "OFFICE_STAFF_OFFICE_STAFF"
          ? await this.conversations.findOne({
              where: {
                kind: pair.kind,
                teacherUserId: pair.teacherUserId,
                peerTeacherUserId: pair.peerTeacherUserId,
              },
            })
          : pair.kind === "GUARDIAN_ADMIN"
            ? await this.conversations.findOne({
                where: {
                  kind: "GUARDIAN_ADMIN",
                  guardianUserId: pair.guardianUserId,
                  adminUserId: pair.adminUserId,
                },
              })
            : pair.kind === "STUDENT_ADMIN"
              ? await this.conversations.findOne({
                  where: {
                    kind: "STUDENT_ADMIN",
                    studentUserId: pair.studentUserId,
                    adminUserId: pair.adminUserId,
                  },
                })
              : pair.kind === "OFFICE_TEACHER" ||
                  pair.kind === "OFFICE_ADMIN" ||
                  pair.kind === "TEACHER_ADMIN"
                ? await this.conversations.findOne({
                    where: {
                      kind: pair.kind,
                      teacherUserId: pair.teacherUserId,
                      adminUserId: pair.adminUserId,
                    },
                  })
                : await this.conversations.findOne({
                    where: {
                      kind: "STUDENT_TEACHER",
                      studentUserId: pair.studentUserId,
                      teacherUserId: pair.teacherUserId,
                    },
                  });

    if (!conversation) {
      conversation = this.conversations.create({
        kind: pair.kind,
        studentUserId: pair.studentUserId,
        teacherUserId: pair.teacherUserId,
        guardianUserId: pair.guardianUserId,
        peerTeacherUserId: pair.peerTeacherUserId,
        adminUserId: pair.adminUserId,
        lastMessageAt: null,
      });
      await this.conversations.save(conversation);
    }

    const peer = await this.users.findOne({
      where: { id: peerUserId },
      select: { id: true, fullName: true, preferredName: true, role: true },
    });
    let enriched: ChatPeer | User | null = peer;
    if (peer?.role === UserRole.GUARDIAN && role === UserRole.STAFF) {
      const guardians = await listGuardiansForTeacher(userId);
      const match = guardians.find((row) => row.userId === peerUserId);
      if (match) enriched = match;
    } else if (
      peer?.role === UserRole.STAFF &&
      role === UserRole.STAFF &&
      pair.kind === "TEACHER_TEACHER"
    ) {
      const teachers = await listTeachersForTeacher(userId);
      const match = teachers.find((row) => row.userId === peerUserId);
      if (match) enriched = match;
    } else if (
      peer?.role === UserRole.OFFICE_STAFF &&
      role === UserRole.OFFICE_STAFF &&
      pair.kind === "OFFICE_STAFF_OFFICE_STAFF"
    ) {
      const peers = await listOfficeStaffForOfficeStaff(userId);
      const match = peers.find((row) => row.userId === peerUserId);
      if (match) enriched = match;
    } else if (pair.kind === "GUARDIAN_ADMIN") {
      if (isAdminChatRole(role)) {
        const guardians = await listGuardiansForAdmin(userId);
        const match = guardians.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      } else if (role === UserRole.GUARDIAN) {
        const admins = await listAdminsForGuardian(userId);
        const match = admins.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      }
    } else if (pair.kind === "STUDENT_ADMIN") {
      if (isAdminChatRole(role)) {
        const students = await listStudentsForSuperAdmin(userId);
        const match = students.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      } else if (role === UserRole.STUDENT) {
        const admins = await listSuperAdminsForStudent(userId);
        const match = admins.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      }
    } else if (pair.kind === "OFFICE_TEACHER") {
      if (role === UserRole.OFFICE_STAFF) {
        const teachers = await listTeachersForOfficeStaff(userId);
        const match = teachers.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      } else if (role === UserRole.STAFF) {
        const officeStaff = await listOfficeStaffForTeacher(userId);
        const match = officeStaff.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      }
    } else if (pair.kind === "OFFICE_ADMIN") {
      if (isAdminChatRole(role)) {
        const officeStaff = await listOfficeStaffForSuperAdmin(userId);
        const match = officeStaff.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      } else if (role === UserRole.OFFICE_STAFF) {
        const admins = await listSuperAdminsForOfficeStaff(userId);
        const match = admins.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      }
    } else if (pair.kind === "TEACHER_ADMIN") {
      if (isAdminChatRole(role)) {
        const teachers = await listTeachersForSuperAdmin(userId);
        const match = teachers.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      } else if (role === UserRole.STAFF) {
        const admins = await listSuperAdminsForTeacher(userId);
        const match = admins.find((row) => row.userId === peerUserId);
        if (match) enriched = match;
      }
    }

    return {
      conversation: await this.toConversationDto(
        conversation,
        userId,
        enriched,
        null,
      ),
    };
  }

  private async requireParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ChatConversation> {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new AppError(404, "Conversation not found", "CHAT_NOT_FOUND");
    }
    if (
      conversation.studentUserId !== userId &&
      conversation.teacherUserId !== userId &&
      conversation.guardianUserId !== userId &&
      conversation.peerTeacherUserId !== userId &&
      conversation.adminUserId !== userId
    ) {
      throw new AppError(403, "Conversation not found", "CHAT_FORBIDDEN");
    }
    if (isGuardianTeacherConversation(conversation)) {
      await assertGuardianTeacherChatEnabled();
    }
    if (isTeacherTeacherConversation(conversation)) {
      await assertTeacherTeacherChatEnabled();
    }
    if (isOfficeStaffPeerConversation(conversation)) {
      await assertOfficeStaffChatEnabled();
    }
    if (isGuardianAdminConversation(conversation)) {
      await assertGuardianAdminChatEnabled();
    }
    if (isStudentAdminConversation(conversation)) {
      await assertStudentAdminChatEnabled();
    }
    if (isOfficeTeacherConversation(conversation)) {
      await assertOfficeTeacherChatEnabled();
    }
    if (isOfficeAdminConversation(conversation)) {
      await assertOfficeAdminChatEnabled();
    }
    if (isTeacherAdminConversation(conversation)) {
      await assertTeacherAdminChatEnabled();
    }
    return conversation;
  }

  async listMessages(
    userId: string,
    role: UserRole,
    conversationId: string,
    options?: { before?: string; limit?: number },
  ) {
    await assertChatRole(role);

    const conversation = await this.requireParticipant(conversationId, userId);
    const peerId = this.peerUserId(conversation, userId);
    await assertCanChat(userId, role, peerId);

    const limit = Math.min(
      Math.max(options?.limit ?? MESSAGE_PAGE_SIZE, 1),
      100,
    );

    const clearedAt = this.clearedAtForUser(conversation, userId);
    const qb = this.messages
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", { conversationId })
      .orderBy("message.createdAt", "DESC")
      .take(limit);

    if (clearedAt) {
      qb.andWhere("message.createdAt > :clearedAt", { clearedAt });
    }

    if (options?.before) {
      const beforeMessage = await this.messages.findOne({
        where: { id: options.before, conversationId },
      });
      if (beforeMessage) {
        qb.andWhere("message.createdAt < :beforeAt", {
          beforeAt: beforeMessage.createdAt,
        });
      }
    }

    const rows = await qb.getMany();

    // Mark inbound undelivered messages as delivered when recipient opens history.
    const now = new Date();
    const undelivered = rows.filter(
      (row) => row.senderUserId !== userId && !row.deliveredAt,
    );
    if (undelivered.length > 0) {
      await this.messages.update(
        { id: In(undelivered.map((row) => row.id)) },
        { deliveredAt: now },
      );
      for (const row of undelivered) {
        row.deliveredAt = now;
      }
      emitToUser(peerId, "message:delivered", {
        conversationId,
        messageIds: undelivered.map((row) => row.id),
        deliveredAt: now.toISOString(),
      });
    }

    return {
      messages: await this.toMessageDtos(rows.reverse()),
      hasMore: rows.length === limit,
      peerOnline: isUserOnline(peerId),
    };
  }

  async searchInConversation(
    userId: string,
    role: UserRole,
    conversationId: string,
    queryRaw: string,
    options?: { limit?: number },
  ) {
    await assertChatRole(role);

    const query = queryRaw.trim();
    if (query.length < 1) {
      return { messages: [] as ReturnType<typeof toMessageDto>[], total: 0 };
    }

    const conversation = await this.requireParticipant(conversationId, userId);
    const peerId = this.peerUserId(conversation, userId);
    await assertCanChat(userId, role, peerId);

    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const clearedAt = this.clearedAtForUser(conversation, userId);

    const qb = this.messages
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", { conversationId })
      .andWhere("message.deletedAt IS NULL")
      .andWhere(
        "(message.body ILIKE :needle OR COALESCE(message.originalName, '') ILIKE :needle)",
        { needle: `%${query}%` },
      )
      .orderBy("message.createdAt", "DESC")
      .take(limit);

    if (clearedAt) {
      qb.andWhere("message.createdAt > :clearedAt", { clearedAt });
    }

    const [rows, total] = await qb.getManyAndCount();

    return {
      messages: await this.toMessageDtos(rows),
      total,
    };
  }

  async sendMessage(
    userId: string,
    role: UserRole,
    conversationId: string,
    bodyRaw: string,
    fileUpload?: IncomingStoredFile | null,
    replyToMessageIdRaw?: string | null,
  ) {
    await assertChatRole(role);

    const body = bodyRaw.trim();
    if (!body && !fileUpload) {
      throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new AppError(
        400,
        `Message must be at most ${MAX_BODY_LENGTH} characters`,
        "VALIDATION_ERROR",
      );
    }

    const conversation = await this.requireParticipant(conversationId, userId);
    const peerId = this.peerUserId(conversation, userId);
    await assertCanChat(userId, role, peerId);

    let replyTarget: ChatMessage | null = null;
    const replyToMessageId = replyToMessageIdRaw?.trim() || null;
    if (replyToMessageId) {
      replyTarget = await this.messages.findOne({
        where: { id: replyToMessageId, conversationId: conversation.id },
      });
      if (!replyTarget) {
        throw new AppError(
          400,
          "Reply target message was not found",
          "VALIDATION_ERROR",
        );
      }
    }

    if (fileUpload?.buffer) {
      const mimeType = await assertValidChatAttachmentBuffer({
        buffer: fileUpload.buffer,
        originalName: fileUpload.originalName,
        mimeType: fileUpload.mimeType,
        size: fileUpload.size,
      });
      fileUpload.mimeType = mimeType;
    } else if (fileUpload) {
      const mime = fileUpload.mimeType.toLowerCase();
      if (!isChatAttachmentMime(mime)) {
        throw new AppError(
          400,
          "Only images, documents, or voice messages are allowed",
          "INVALID_UPLOAD",
        );
      }
      if (!fileUpload.directStorageKey) {
        throw new AppError(400, "File data is required", "INVALID_UPLOAD");
      }
    }

    const peerOnline = isUserOnline(peerId);
    const message = this.messages.create({
      conversationId: conversation.id,
      senderUserId: userId,
      body,
      storageKey: null,
      thumbnailStorageKey: null,
      originalName: null,
      mimeType: null,
      byteSize: null,
      deliveredAt: peerOnline ? new Date() : null,
      readAt: null,
      voicePlayedAt: null,
      deletedAt: null,
      replyToMessageId: replyTarget?.id ?? null,
    });
    await this.messages.save(message);

    if (fileUpload) {
      const storageKey = buildChatImageKey({
        conversationId: conversation.id,
        messageId: message.id,
        fileName: fileUpload.originalName,
      });
      try {
        const stored = await storeUploadedObject({
          finalKey: storageKey,
          contentType: fileUpload.mimeType,
          buffer: fileUpload.buffer,
          directStorageKey: fileUpload.directStorageKey,
          byteSize: fileUpload.size,
        });
        message.storageKey = stored.key;
        message.originalName = fileUpload.originalName;
        message.mimeType = fileUpload.mimeType;
        message.byteSize = stored.byteSize || fileUpload.size;

        if (isChatImageMime(fileUpload.mimeType)) {
          const thumbKey = await createAndStoreChatThumbnail({
            conversationId: conversation.id,
            messageId: message.id,
            sourceBuffer: fileUpload.buffer,
            sourceStorageKey: stored.key,
          });
          message.thumbnailStorageKey = thumbKey;
        }

        await this.messages.save(message);
      } catch (error) {
        await this.messages.delete({ id: message.id });
        void deleteObject(storageKey).catch(() => undefined);
        if (message.thumbnailStorageKey) {
          void deleteObject(message.thumbnailStorageKey).catch(() => undefined);
        }
        throw error;
      }
    }

    conversation.lastMessageAt = message.createdAt;
    conversation.updatedAt = new Date();
    await this.conversations.save(conversation);

    const dto = toMessageDto(message, replyTarget);
    const peerUnread = await this.unreadCountForUser(peerId);
    const senderUnread = await this.unreadCountForUser(userId);

    const sender = await this.users.findOne({
      where: { id: userId },
      select: { id: true, fullName: true, preferredName: true },
    });
    const peer = await this.users.findOne({
      where: { id: peerId },
      select: { id: true, fullName: true, preferredName: true },
    });

    const senderConversation = await this.toConversationDto(
      conversation,
      userId,
      peer,
      message,
    );
    const peerConversation = await this.toConversationDto(
      conversation,
      peerId,
      sender,
      message,
    );

    emitToUser(peerId, "message:new", {
      conversationId: conversation.id,
      message: dto,
      conversation: peerConversation,
      unreadCount: peerUnread,
    });
    emitToUser(userId, "conversation:updated", {
      conversationId: conversation.id,
      message: dto,
      conversation: senderConversation,
      unreadCount: senderUnread,
    });
    if (peerOnline) {
      emitToUser(userId, "message:delivered", {
        conversationId: conversation.id,
        messageIds: [message.id],
        deliveredAt: message.deliveredAt!.toISOString(),
      });
    }

    const peerMuted = this.isMutedForUser(conversation, peerId);
    const peerViewing = await isUserViewingConversation(
      peerId,
      conversation.id,
    );
    if (!peerMuted && !peerViewing) {
      const senderName = sender
        ? peerDisplayName({
            fullName: sender.fullName,
            preferredName: sender.preferredName,
          })
        : "New message";
      const preview = messagePreview(message) || "New message";
      void notifyUsers([
        {
          userId: peerId,
          type: "CHAT_MESSAGE",
          title: senderName,
          body: preview,
          data: {
            conversationId: conversation.id,
            messageId: message.id,
            href: chatNotificationHref(conversation, peerId),
          },
        },
      ]);
    }

    return { message: dto, conversation: senderConversation };
  }

  async editMessage(
    userId: string,
    role: UserRole,
    conversationId: string,
    messageId: string,
    bodyRaw: string,
  ) {
    await assertChatRole(role);

    const body = bodyRaw.trim();
    if (!body) {
      throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new AppError(
        400,
        `Message must be at most ${MAX_BODY_LENGTH} characters`,
        "VALIDATION_ERROR",
      );
    }

    const conversation = await this.requireParticipant(conversationId, userId);
    const message = await this.messages.findOne({
      where: { id: messageId, conversationId },
    });
    if (!message) {
      throw new AppError(404, "Message not found", "NOT_FOUND");
    }
    if (message.senderUserId !== userId) {
      throw new AppError(
        403,
        "Only the sender can edit this message",
        "CHAT_FORBIDDEN",
      );
    }
    if (message.deletedAt) {
      throw new AppError(400, "Deleted messages cannot be edited", "VALIDATION_ERROR");
    }
    if (!message.body?.trim() && message.storageKey) {
      throw new AppError(
        400,
        "Media-only messages cannot be edited",
        "VALIDATION_ERROR",
      );
    }

    message.body = body;
    message.editedAt = new Date();
    await this.messages.save(message);

    conversation.updatedAt = new Date();
    await this.conversations.save(conversation);

    const [dto] = await this.toMessageDtos([message]);
    const peerId = this.peerUserId(conversation, userId);
    const lastMessage = await this.messages.findOne({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    const sender = await this.users.findOne({
      where: { id: userId },
      select: { id: true, fullName: true, preferredName: true },
    });
    const peer = await this.users.findOne({
      where: { id: peerId },
      select: { id: true, fullName: true, preferredName: true },
    });
    const senderConversation = await this.toConversationDto(
      conversation,
      userId,
      peer,
      lastMessage,
    );
    const peerConversation = await this.toConversationDto(
      conversation,
      peerId,
      sender,
      lastMessage,
    );
    const peerUnread = await this.unreadCountForUser(peerId);
    const senderUnread = await this.unreadCountForUser(userId);

    emitToUser(peerId, "message:updated", {
      conversationId,
      message: dto,
      conversation: peerConversation,
      unreadCount: peerUnread,
    });
    emitToUser(userId, "message:updated", {
      conversationId,
      message: dto,
      conversation: senderConversation,
      unreadCount: senderUnread,
    });

    return { message: dto!, conversation: senderConversation };
  }

  async setConversationMuted(
    userId: string,
    role: UserRole,
    conversationId: string,
    muted: boolean,
  ) {
    await assertChatRole(role);

    const conversation = await this.requireParticipant(conversationId, userId);
    const now = muted ? new Date() : null;
    if (conversation.adminUserId === userId) {
      conversation.adminMutedAt = now;
    } else if (conversation.peerTeacherUserId === userId) {
      conversation.peerTeacherMutedAt = now;
    } else if (conversation.guardianUserId === userId) {
      conversation.guardianMutedAt = now;
    } else if (conversation.studentUserId === userId) {
      conversation.studentMutedAt = now;
    } else {
      conversation.teacherMutedAt = now;
    }
    conversation.updatedAt = new Date();
    await this.conversations.save(conversation);

    const lastMessage = await this.messages.findOne({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    const peerId = this.peerUserId(conversation, userId);
    const peer = await this.users.findOne({
      where: { id: peerId },
      select: { id: true, fullName: true, preferredName: true },
    });
    const dto = await this.toConversationDto(
      conversation,
      userId,
      peer,
      lastMessage,
    );
    return { conversation: dto };
  }

  async clearConversation(
    userId: string,
    role: UserRole,
    conversationId: string,
  ) {
    await assertChatRole(role);

    const conversation = await this.requireParticipant(conversationId, userId);
    this.setClearedAtForUser(conversation, userId, new Date());
    conversation.updatedAt = new Date();
    await this.conversations.save(conversation);

    const peerId = this.peerUserId(conversation, userId);
    const peer = await this.users.findOne({
      where: { id: peerId },
      select: { id: true, fullName: true, preferredName: true, role: true },
    });
    const dto = await this.toConversationDto(
      conversation,
      userId,
      peer,
      null,
    );
    return { conversation: dto, ok: true as const };
  }

  async listConversationMedia(
    userId: string,
    role: UserRole,
    conversationId: string,
    options?: { kind?: "image" | "document" | "all"; limit?: number },
  ) {
    await assertChatRole(role);

    const conversation = await this.requireParticipant(conversationId, userId);
    const peerId = this.peerUserId(conversation, userId);
    await assertCanChat(userId, role, peerId);

    const kind = options?.kind ?? "all";
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 400);
    const clearedAt = this.clearedAtForUser(conversation, userId);

    const qb = this.messages
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", { conversationId })
      .andWhere("message.deletedAt IS NULL")
      .andWhere("message.storageKey IS NOT NULL")
      .andWhere("message.mimeType IS NOT NULL")
      .orderBy("message.createdAt", "DESC")
      .take(limit);

    if (clearedAt) {
      qb.andWhere("message.createdAt > :clearedAt", { clearedAt });
    }

    const rows = await qb.getMany();
    const items = rows
      .filter((row) => {
        const mime = row.mimeType ?? "";
        if (kind === "image") return isChatImageMime(mime);
        if (kind === "document") {
          return isChatDocumentMime(mime) && !isChatAudioMime(mime);
        }
        // all: images + documents (exclude voice)
        return (
          isChatImageMime(mime) ||
          (isChatDocumentMime(mime) && !isChatAudioMime(mime))
        );
      })
      .map((row) => {
        const mime = row.mimeType!;
        const mediaKind: "image" | "document" = isChatImageMime(mime)
          ? "image"
          : "document";
        return {
          messageId: row.id,
          kind: mediaKind,
          originalName: row.originalName ?? "file",
          mimeType: mime,
          byteSize: row.byteSize ?? 0,
          createdAt: row.createdAt.toISOString(),
        };
      });

    return {
      images: items.filter((row) => row.kind === "image"),
      documents: items.filter((row) => row.kind === "document"),
    };
  }

  async getMessageMedia(
    userId: string,
    role: UserRole,
    conversationId: string,
    messageId: string,
    variant: "full" | "thumb" = "full",
  ) {
    await assertChatRole(role);

    await this.requireParticipant(conversationId, userId);
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    const message = await this.messages.findOne({
      where: { id: messageId, conversationId },
    });
    if (
      message?.deletedAt ||
      !message?.storageKey ||
      !message.mimeType ||
      !message.originalName
    ) {
      throw new AppError(404, "Attachment not found", "NOT_FOUND");
    }
    if (conversation) {
      const clearedAt = this.clearedAtForUser(conversation, userId);
      if (clearedAt && message.createdAt <= clearedAt) {
        throw new AppError(404, "Attachment not found", "NOT_FOUND");
      }
    }

    if (
      variant === "thumb" &&
      message.thumbnailStorageKey &&
      isChatImageMime(message.mimeType)
    ) {
      return {
        storageKey: message.thumbnailStorageKey,
        mimeType: "image/webp",
        originalName: "thumb.webp",
      };
    }

    return {
      storageKey: message.storageKey,
      mimeType: message.mimeType,
      originalName: message.originalName,
    };
  }

  async markRead(userId: string, role: UserRole, conversationId: string) {
    await assertChatRole(role);

    const conversation = await this.requireParticipant(conversationId, userId);
    const peerId = this.peerUserId(conversation, userId);

    const unread = await this.messages.find({
      where: {
        conversationId,
        senderUserId: Not(userId),
        readAt: IsNull(),
        deletedAt: IsNull(),
      },
      select: { id: true },
    });

    const now = new Date();
    if (unread.length > 0) {
      await this.messages.update(
        {
          conversationId,
          senderUserId: Not(userId),
          readAt: IsNull(),
          deletedAt: IsNull(),
        },
        { readAt: now, deliveredAt: now },
      );
    }

    const unreadCount = await this.unreadCountForUser(userId);
    const messageIds = unread.map((row) => row.id);
    const readAt = now.toISOString();

    emitToUser(userId, "message:read", {
      conversationId,
      messageIds,
      readAt,
      unreadCount,
    });
    emitToUser(peerId, "message:read", {
      conversationId,
      messageIds,
      readAt,
    });

    return { ok: true, unreadCount, messageIds, readAt };
  }

  async deleteMessage(
    userId: string,
    role: UserRole,
    conversationId: string,
    messageId: string,
  ) {
    await assertChatRole(role);

    const conversation = await this.requireParticipant(conversationId, userId);
    const message = await this.messages.findOne({
      where: { id: messageId, conversationId },
    });
    if (!message) {
      throw new AppError(404, "Message not found", "NOT_FOUND");
    }
    if (message.senderUserId !== userId) {
      throw new AppError(
        403,
        "Only the sender can delete this message",
        "CHAT_FORBIDDEN",
      );
    }
    if (message.deletedAt) {
      const [dto] = await this.toMessageDtos([message]);
      return {
        message: dto!,
        conversation: await this.toConversationDto(
          conversation,
          userId,
          null,
          message,
        ),
      };
    }

    const storageKey = message.storageKey;
    const thumbnailStorageKey = message.thumbnailStorageKey;
    message.deletedAt = new Date();
    message.body = "";
    message.storageKey = null;
    message.thumbnailStorageKey = null;
    message.originalName = null;
    message.mimeType = null;
    message.byteSize = null;
    message.voicePlayedAt = null;
    await this.messages.save(message);

    if (storageKey) {
      await deleteObject(storageKey).catch(() => undefined);
    }
    if (thumbnailStorageKey) {
      await deleteObject(thumbnailStorageKey).catch(() => undefined);
    }

    conversation.updatedAt = new Date();
    await this.conversations.save(conversation);

    const peerId = this.peerUserId(conversation, userId);
    const lastMessage = await this.messages.findOne({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    const sender = await this.users.findOne({
      where: { id: userId },
      select: { id: true, fullName: true, preferredName: true },
    });
    const peer = await this.users.findOne({
      where: { id: peerId },
      select: { id: true, fullName: true, preferredName: true },
    });

    const [dto] = await this.toMessageDtos([message]);
    const senderConversation = await this.toConversationDto(
      conversation,
      userId,
      peer,
      lastMessage,
    );
    const peerConversation = await this.toConversationDto(
      conversation,
      peerId,
      sender,
      lastMessage,
    );
    const peerUnread = await this.unreadCountForUser(peerId);
    const senderUnread = await this.unreadCountForUser(userId);

    emitToUser(peerId, "message:deleted", {
      conversationId,
      message: dto,
      conversation: peerConversation,
      unreadCount: peerUnread,
    });
    emitToUser(userId, "message:deleted", {
      conversationId,
      message: dto,
      conversation: senderConversation,
      unreadCount: senderUnread,
    });

    return { message: dto, conversation: senderConversation };
  }

  async markVoicePlayed(
    userId: string,
    role: UserRole,
    conversationId: string,
    messageId: string,
  ) {
    await assertChatRole(role);

    await this.requireParticipant(conversationId, userId);
    const message = await this.messages.findOne({
      where: { id: messageId, conversationId },
    });
    if (!message || message.deletedAt || !message.storageKey || !message.mimeType) {
      throw new AppError(404, "Voice message not found", "NOT_FOUND");
    }
    const mime = message.mimeType.toLowerCase();
    const isAudio =
      mime.startsWith("audio/") || mime === "video/webm" || mime === "video/mp4";
    if (!isAudio) {
      throw new AppError(400, "Message is not a voice note", "VALIDATION_ERROR");
    }
    // Only the recipient can mark a voice note as played.
    if (message.senderUserId === userId) {
      throw new AppError(
        403,
        "Sender cannot mark their own voice note as played",
        "CHAT_FORBIDDEN",
      );
    }

    const now = message.voicePlayedAt ?? new Date();
    if (!message.voicePlayedAt) {
      message.voicePlayedAt = now;
      if (!message.deliveredAt) message.deliveredAt = now;
      if (!message.readAt) message.readAt = now;
      await this.messages.save(message);
    }

    const voicePlayedAt = now.toISOString();
    const peerId = message.senderUserId;
    emitToUser(peerId, "message:voice-played", {
      conversationId,
      messageId: message.id,
      voicePlayedAt,
    });
    emitToUser(userId, "message:voice-played", {
      conversationId,
      messageId: message.id,
      voicePlayedAt,
    });

    return { ok: true, messageId: message.id, voicePlayedAt };
  }

  async unreadCount(userId: string) {
    return { unreadCount: await this.unreadCountForUser(userId) };
  }
}

export const chatService = new ChatService();
