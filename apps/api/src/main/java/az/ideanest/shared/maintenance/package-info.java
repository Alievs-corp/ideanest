/**
 * The published contract for "is the platform closed for maintenance" — issue #214.
 *
 * <p><strong>Why a port in {@code shared} rather than a call into the platform
 * module.</strong> The question is asked from three places that cannot all depend on
 * {@code platform}: the job runner lives in {@code shared.jobs} itself, the auth
 * module refuses a reader's session with it, and the web layer renders the refusal.
 * {@code shared} may not depend on a module, and a module that did depend on
 * {@code platform} for this would be one edge away from a cycle the day
 * {@code platform} reads anything back. So the question and its answer's shape are
 * published here and {@code platform.application.MaintenanceWindows} answers it — the
 * same arrangement as {@link az.ideanest.shared.access.PlatformStaff}.
 *
 * <p><strong>The response body is published here too</strong>, because it is a wire
 * contract with two producers — the servlet filter and the auth module's refusal of a
 * reader's sign-in — and a third one outside this service entirely: the edge's static
 * copy under {@code ops/}. One record, so that the first two cannot drift apart.
 */
package az.ideanest.shared.maintenance;
