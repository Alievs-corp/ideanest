package az.ideanest.dashboard.application;

/**
 * The window asked for cannot be read — #222.
 *
 * <p>Empty, backwards, or longer than a year. A year is what a front page is read over; a longer
 * window would make the heaviest query behind it, the distinct count of backers, hold a
 * connection for as long as it took.
 */
public class InvalidDashboardRangeException extends RuntimeException {

    public InvalidDashboardRangeException(String message) {
        super(message);
    }
}
