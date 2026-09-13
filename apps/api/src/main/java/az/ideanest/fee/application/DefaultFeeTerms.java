package az.ideanest.fee.application;

import java.math.BigDecimal;

/** The fee that applies when no schedule is in force — see {@code FeeProperties}. IDN-EXT-01 (#42). */
public record DefaultFeeTerms(BigDecimal platformRate, BigDecimal processingRate, String currency) {
}
