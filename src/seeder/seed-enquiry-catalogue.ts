import { IsNull } from "typeorm";
import { AppDataSource } from "../config/data-source.js";
import { logger } from "../config/logger.js";
import {
  DEFAULT_ENQUIRY_COMPETITORS,
  DEFAULT_ENQUIRY_SOURCES,
  DEFAULT_ENQUIRY_STAGES,
  DEFAULT_LOSS_REASONS,
} from "../common/constants/enquiry.js";
import {
  EnquiryCompetitor,
  EnquiryLossReason,
  EnquirySource,
  EnquiryStage,
} from "../entities/index.js";

export async function seedEnquiryCatalogue() {
  const stages = AppDataSource.getRepository(EnquiryStage);
  const sources = AppDataSource.getRepository(EnquirySource);
  const competitors = AppDataSource.getRepository(EnquiryCompetitor);
  const reasons = AppDataSource.getRepository(EnquiryLossReason);

  for (const stage of DEFAULT_ENQUIRY_STAGES) {
    const existing = await stages.findOne({ where: { code: stage.code } });
    if (existing) {
      existing.name = stage.name;
      existing.sortOrder = stage.sortOrder;
      existing.kind = stage.kind;
      await stages.save(existing);
      continue;
    }
    await stages.save(stages.create({ ...stage, retiredAt: null }));
  }

  let sourceOrder = 0;
  for (const name of DEFAULT_ENQUIRY_SOURCES) {
    sourceOrder += 1;
    const existing = await sources.findOne({ where: { name } });
    if (existing) continue;
    await sources.save(sources.create({ name, sortOrder: sourceOrder }));
  }

  for (const name of DEFAULT_ENQUIRY_COMPETITORS) {
    const existing = await competitors.findOne({ where: { name } });
    if (existing) continue;
    await competitors.save(competitors.create({ name }));
  }

  const stageRows = await stages.find();
  const byCode = new Map(stageRows.map((row) => [row.code, row]));

  for (const reason of DEFAULT_LOSS_REASONS) {
    const stage = byCode.get(reason.stageCode);
    if (!stage) continue;
    const existing = await reasons.findOne({
      where: { stageId: stage.id, name: reason.name, retiredAt: IsNull() },
    });
    if (existing) continue;
    await reasons.save(
      reasons.create({
        stageId: stage.id,
        name: reason.name,
        requiresCompetitor: reason.requiresCompetitor,
      }),
    );
  }

  logger.info("Enquiry catalogue seeded");
}
