package az.ideanest.project.domain;

/**
 * Where in the campaign editor a requirement is fixed.
 *
 * <p><strong>A checklist that says what is wrong and not where to fix it is a
 * list of complaints.</strong> "The story is 140 characters" is only actionable
 * if the creator can get to the story from the sentence that says so, and the
 * section is what lets the client make each failing row a link rather than a
 * paragraph the creator has to translate into navigation.
 *
 * <p>The keys are the campaign editor's route segments — {@code EDITOR_TABS} in
 * {@code packages/campaign-editor/src/tabs.ts} — because that is what
 * the client builds the link out of. They are therefore part of the wire
 * contract: renaming one is a change to the client's routing as well as to this
 * enum, which is the correct amount of friction.
 *
 * <p>Only the sections a requirement actually points at exist here. A value for
 * a tab nothing sends anybody to would be a value the client has to handle and
 * can never receive, which is how a client acquires a branch nobody has ever run.
 */
public enum EditorSection {

    /** Title, summary, category, goal, duration, cover image, scheduled launch. */
    BASICS("basics"),

    /** Items and reward tiers. */
    REWARDS("rewards"),

    /** The story document and the mandatory risks section. */
    STORY("story");

    private final String key;

    EditorSection(String key) {
        this.key = key;
    }

    /** The editor's route segment for this section, as the client names it. */
    public String key() {
        return key;
    }
}
