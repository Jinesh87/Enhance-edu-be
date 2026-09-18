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
  assertGuardianTeacherChatEnabled,
  isGuardianTeacherConversation,
  listGuardiansForTeacher,
  listStudentsForTeacher,
  listTeachersForGuardian,
  listTeachersForStudent,
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
    await assertGuardianTeacherChatEnabled();
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
  if (isGuardianTeacherConversation(conversation)) {
    return conversation.guardianUserId === recipientUserId
      ? `/guardian/messages/${conversation.id}`
      : `/tutor/messages/${conversation.id}`;
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
    } else if (role === UserRole.GUARDIAN) {
      contacts = await listTeachersForGuardian(userId);
    } else if (role === UserRole.STAFF) {
      contacts = await listStudentsForTeacher(userId);
      if (await settingsService.isGuardianTeacherChatEnabled()) {
        contacts = [...contacts, ...(await listGuardiansForTeacher(userId))];
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
        "(conversation.studentUserId = :userId OR conversation.teacherUserId = :userId OR conversation.guardianUserId = :userId)",
        { userId },
      )
      .andWhere(
        `(
          (conversation.studentUserId = :userId AND (conversation.studentClearedAt IS NULL OR message.createdAt > conversation.studentClearedAt))
          OR (conversation.teacherUserId = :userId AND (conversation.teacherClearedAt IS NULL OR message.createdAt > conversation.teacherClearedAt))
          OR (conversation.guardianUserId = :userId AND (conversation.guardianClearedAt IS NULL OR message.createdAt > conversation.guardianClearedAt))
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
    if (isGuardianTeacherConversation(conversation)) {
      return conversation.guardianUserId === viewerUserId
        ? conversation.teacherUserId
        : conversation.guardianUserId!;
    }
    return conversation.studentUserId === viewerUserId
      ? conversation.teacherUserId
      : conversation.studentUserId!;
  }

  private isMutedForUser(
    conversation: ChatConversation,
    viewerUserId: string,
  ) {
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
    if (conversation.guardianUserId === viewerUserId) {
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
      peerRole = isGuardianTeacherConversation(conversation)
        ? conversation.guardianUserId === peerId
          ? UserRole.GUARDIAN
          : UserRole.STAFF
        : conversation.studentUserId === peerId
          ? UserRole.STUDENT
          : UserRole.STAFF;
    }
    if (!peerSubtitle && peerRole === UserRole.GUARDIAN) {
      peerSubtitle = "Guardian";
    }

    const unreadCount = await this.unreadCountForUser(
      viewerUserId,
      conversation.id,
    );

    return {
      id: conversation.id,
      kind: isGuardianTeacherConversation(conversation)
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
          : { teacherUserId: userId, lastMessageAt: Not(IsNull()) };

    let conversations = await this.conversations.find({
      where,
      order: { lastMessageAt: "DESC", updatedAt: "DESC" },
      take: 100,
    });

    if (
      role === UserRole.STAFF &&
      !(await settingsService.isGuardianTeacherChatEnabled())
    ) {
      conversations = conversations.filter(
        (row) => !isGuardianTeacherConversation(row),
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

    let guardianSubtitles = new Map<string, string>();
    if (role === UserRole.STAFF) {
      const guardians = await listGuardiansForTeacher(userId);
      guardianSubtitles = new Map(
        guardians
          .filter((row) => row.subtitle)
          .map((row) => [row.userId, row.subtitle!]),
      );
    }

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
              subtitle: guardianSubtitles.get(peerId) ?? null,
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
        "(conversation.studentUserId = :userId OR conversation.teacherUserId = :userId OR conversation.guardianUserId = :userId)",
        { userId },
      )
      .andWhere("message.deletedAt IS NULL")
      .andWhere("message.body ILIKE :needle", { needle: `%${query}%` })
      .andWhere(
        `(
          (conversation.studentUserId = :userId AND (conversation.studentClearedAt IS NULL OR message.createdAt > conversation.studentClearedAt))
          OR (conversation.teacherUserId = :userId AND (conversation.teacherClearedAt IS NULL OR message.createdAt > conversation.teacherClearedAt))
          OR (conversation.guardianUserId = :userId AND (conversation.guardianClearedAt IS NULL OR message.createdAt > conversation.guardianClearedAt))
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
      conversation.guardianUserId !== userId
    ) {
      throw new AppError(403, "Conversation not found", "CHAT_FORBIDDEN");
    }
    if (isGuardianTeacherConversation(conversation)) {
      await assertGuardianTeacherChatEnabled();
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
    if (conversation.guardianUserId === userId) {
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
