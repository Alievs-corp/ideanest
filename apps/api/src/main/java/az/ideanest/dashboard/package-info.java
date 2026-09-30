/**
 * The console's front page — #222.
 *
 * <p>A leaf: it depends on the published {@code shared.dashboard.DashboardSection} and on
 * nothing that implements it, so no module that contributes a card can ever form a cycle with
 * it. Each contributing module owns its own figures and its own capability requirement.
 */
package az.ideanest.dashboard;
