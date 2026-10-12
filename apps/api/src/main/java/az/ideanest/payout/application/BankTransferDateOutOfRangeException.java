package az.ideanest.payout.application;

import java.time.LocalDate;

/**
 * A bank transfer recorded with a value date it cannot have — #397.
 *
 * <p>400. After today is a transfer that has not happened; before the day it was started is a transfer
 * made before anybody here opened the account it went to. Either is a misread statement.
 */
public class BankTransferDateOutOfRangeException extends RuntimeException {

    public BankTransferDateOutOfRangeException(LocalDate transferredOn, LocalDate earliest, LocalDate latest) {
        super("A transfer on " + transferredOn + " is outside " + earliest + " to " + latest);
    }
}
