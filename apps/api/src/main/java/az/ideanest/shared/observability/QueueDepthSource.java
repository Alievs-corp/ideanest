package az.ideanest.shared.observability;

/**
 * How much work is waiting in one queue, answered by the module that owns it — §4.11's
 * AD-16, issue #316.
 *
 * <p><strong>This is {@code ProjectAudienceSource}'s shape, and it is here for the same
 * reason.</strong> AD-16's screen wants the depth of every queue on the platform, and the
 * queues live in three modules — the outbox and the job runner in {@code shared}, email
 * delivery in {@code notification}. A health service that read those tables itself would
 * be reaching into other modules' infrastructure, which {@code ModuleBoundaryTests}
 * forbids and which would make adding a queue a change to a module that does not own it.
 *
 * <p>So the asking side names this interface and the owning side implements it. A new
 * queue appears on the screen by adding a bean, and the screen needs no edit at all.
 *
 * <p><strong>Both counts, never one.</strong> A deep queue is a platform under load; a
 * dead row is a platform that has given up and will not recover without somebody. A single
 * number would let a thousand-item backlog hide one message that will never be sent —
 * {@code SystemHealth.QueueDepth} grades them differently for exactly that reason.
 */
public interface QueueDepthSource {

    /**
     * What this queue is called, as an identifier.
     *
     * <p>{@code outbox}, {@code scheduled-jobs}, {@code emails} — a stable machine value in
     * one case with no spaces, because it is two things and neither of them is a sentence:
     * it is a metric tag, and it is the key the console looks a translated label up under.
     *
     * <p><strong>It used to be the words a member of staff uses, and #405 is what that
     * cost.</strong> The console rendered "Outbox" and "Scheduled jobs" verbatim under an
     * Azerbaijani heading, directly above a section headed with the Azerbaijani for the
     * second of them — one concept in two languages on one screen. A name a screen can
     * render without a catalogue is one that can only ever be in one language, and §21.1
     * says which language a service's own strings are in until it is translated.
     */
    String queueName();

    /** Rows waiting to be handled. */
    long waiting();

    /**
     * Whether the health screen lists this as a queue.
     *
     * <p>True for every queue there is. False only for the scheduler, which publishes its
     * dead count here so that {@code QueueDeadLetters} pages somebody about a job that has
     * given up, and has nothing to say as a queue: it holds one row per job, not a backlog,
     * and the screen grades each of those rows itself. Listing it as well put the same
     * jobs on the screen twice, once under a count that meant nothing.
     */
    default boolean listedAsQueue() {
        return true;
    }

    /**
     * Rows that ran out of attempts and will not be retried.
     *
     * <p>Zero for a queue that has no dead state, which is an honest answer rather than a
     * missing one: it means nothing here has been abandoned, not that abandonment is
     * unmeasured.
     */
    long dead();
}
