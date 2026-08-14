import Joi from "joi";

export const taskIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
