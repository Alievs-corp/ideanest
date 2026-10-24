package az.ideanest.project.application;

import az.ideanest.project.domain.LockedField;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectState;

/**
 * What §5.3 has frozen on a campaign, for a module that may not name a campaign.
 *
 * <p>The reward module enforces two of the five rules in {@link ProjectEditLocks} —
 * a tier's price and the direction its quantity may move — and it cannot read them
 * itself: {@link Project} and {@link ProjectState} live in this module's
 * {@code domain} package, which {@code ModuleBoundaryTests} forbids another module
 * from reaching into. Modules talk through their application layer, and this is
 * that sentence for the one question the reward module has to ask.
 *
 * <p><strong>Answers, not the table.</strong> The components are booleans and a
 * state name rather than the {@link LockedField} values they came from, so nothing
 * outside this module holds a copy of the vocabulary and no caller can be tempted
 * to re-derive "has it launched" from a set it was handed. When a sixth rule is
 * added to the table, the modules that care gain a component here and the ones that
 * do not are unaffected.
 *
 * @param state the campaign's state, by name, because a refusal has to say what
 *     refused it and the reward module has no enum to say it with
 * @param rewardPriceLocked whether {@code price} may no longer be changed
 * @param rewardQuantityLoweringLocked whether a tier's {@code limitQuantity} may
 *     only be raised. Not "may not be changed": §5.3 permits raising it at any
 *     time, and a name that said otherwise would invite the wrong refusal
 * @param rewardWritingHeld whether a tier's title, description, picture and clip go to the
 *     campaign's revision for a moderator rather than to the tier (#559): the public has seen
 *     the campaign
 */
public record EditLocks(
        String state,
        boolean rewardPriceLocked,
        boolean rewardQuantityLoweringLocked,
        boolean rewardWritingHeld) {

    /** Read off the one table, so that the two modules cannot come to disagree. */
    public static EditLocks of(Project project) {
        ProjectState state = project.getState();
        return new EditLocks(
                state.name(),
                ProjectEditLocks.locks(state, LockedField.REWARD_PRICE),
                ProjectEditLocks.locks(state, LockedField.REWARD_QUANTITY_DECREASE),
                ProjectEditLocks.isLaunched(state));
    }
}
