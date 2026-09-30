import { CONTENT_ACTIONS } from './actions/content';
import { TAG_ACTIONS } from './actions/tags';
import { USER_ACTIONS } from './actions/users';
import { ENTITLEMENT_ACTIONS } from './actions/entitlements';
import { AI_PROMPT_ACTIONS } from './actions/ai-prompts';
import { IMAGE_GENERATION_ACTIONS } from './actions/image-generation';
export { ADMIN_ACTION_VERSIONS, adminActionVersion } from './actions/core';
export type { AdminBusinessAction, AdminActionContext, AdminActionField, AdminVersionResource } from './actions/core';

export const ADMIN_BUSINESS_ACTIONS = [...CONTENT_ACTIONS, ...TAG_ACTIONS, ...USER_ACTIONS, ...ENTITLEMENT_ACTIONS, ...AI_PROMPT_ACTIONS, ...IMAGE_GENERATION_ACTIONS];
