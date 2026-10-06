// Run an action that the main process may refuse until a manager agrees:
// on DISCOUNT_NEEDS_MANAGER / RETURN_NEEDS_MANAGER / TRAINING_NEEDS_MANAGER the manager's PIN is asked,
// then the same action runs again with it (the main process checks it).
import { errorCode, translateError } from '../i18n/errors';
import { useApprovalStore } from '../stores/approvalStore';

export const APPROVAL_CODES = ['DISCOUNT_NEEDS_MANAGER', 'RETURN_NEEDS_MANAGER', 'TRAINING_NEEDS_MANAGER'];

export class ApprovalCancelled extends Error {
    constructor() { super('APPROVAL_CANCELLED|{}'); this.cancelled = true; }
}

export async function withManagerApproval(action) {
    try {
        return await action(null);
    } catch (error) {
        const found = errorCode(error);
        if (!found || !APPROVAL_CODES.includes(found.code)) throw error;
        const approval = await useApprovalStore.getState().ask(translateError(error));
        if (!approval) throw new ApprovalCancelled();
        return action(approval);
    }
}
