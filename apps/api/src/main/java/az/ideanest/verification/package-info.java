/**
 * Identity verification for creators — §22.1's anti-money-laundering row, §5.4's R6,
 * issue #105.
 *
 * <p>Document capture, restricted access, and a retention limit. <strong>Not a
 * threshold.</strong> §22.1 lists "identity verification thresholds for creators" among
 * the questions requiring a specific legal answer and #71 carries
 * {@code status: needs-decision}; a threshold invented here would be a compliance position
 * this repository made up. So nothing on the platform is gated on the outcome yet, and
 * {@code VerificationProperties} is where the gate goes when somebody may decide it.
 *
 * <p><strong>Student verification lives here too</strong> (#655): an institution, a student card
 * number, a photograph of the card and a selfie, approved by staff for a year. It answers a
 * different question — "may this account buy the student plan", not "who is this person" — about
 * the same kind of material under the same rules, so it reuses this module's
 * {@code DocumentCipher}, {@code DocumentBytes}, retention pattern and staff capabilities rather
 * than growing a second copy of them in a module of its own. {@code StudentVerifications} answers
 * {@code shared.access.StudentStandings} for the subscription module, which may not read these
 * tables.
 */
package az.ideanest.verification;
