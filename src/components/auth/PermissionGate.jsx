import { useT } from '../../i18n';
/**
 * PermissionGate Component
 * 
 * Conditionally renders children based on user permissions.
 * Use this to hide/show UI elements based on role permissions.
 */

import { useAuthStore } from '../../stores/authStore';

/**
 * @param {Object} props
 * @param {string|string[]} props.permission - Required permission(s)
 * @param {boolean} props.requireAll - If true, requires ALL permissions (default: any)
 * @param {React.ReactNode} props.children - Content to render if permitted
 * @param {React.ReactNode} props.fallback - Optional fallback content if not permitted
 */
export function PermissionGate({
    permission,
    requireAll = false,
    children,
    fallback = null
}) {
    const { hasPermission, hasAnyPermission, hasAllPermissions } = useAuthStore();

    const permissions = Array.isArray(permission) ? permission : [permission];

    let hasAccess = false;

    if (permissions.length === 1) {
        hasAccess = hasPermission(permissions[0]);
    } else if (requireAll) {
        hasAccess = hasAllPermissions(permissions);
    } else {
        hasAccess = hasAnyPermission(permissions);
    }

    if (!hasAccess) {
        return fallback;
    }

    return children;
}

/**
 * Disable wrapper - shows children but disables interactions
 */
export function PermissionDisable({
    permission,
    children,
    disabledClassName = 'opacity-50 pointer-events-none'
}) {
    const { hasPermission } = useAuthStore();
    const { t } = useT();

    const permissions = Array.isArray(permission) ? permission : [permission];
    const hasAccess = permissions.some(p => hasPermission(p));

    if (!hasAccess) {
        return (
            <div className={disabledClassName} title={t('common.noPermission')}>
                {children}
            </div>
        );
    }

    return children;
}
