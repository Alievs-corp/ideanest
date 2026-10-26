package az.ideanest.shared;

import jakarta.validation.valueextraction.ExtractedValue;
import jakarta.validation.valueextraction.ValueExtractor;

/**
 * Lets a constraint on a {@link Patched} field's type argument reach the value inside it (#587).
 *
 * <p>{@code Patched<@Size(max = 300) List<String>> countries} is how a partial update bounds a
 * list: without this, Hibernate Validator has no way into the wrapper and the annotation would
 * be refused as unsupported. An absent field and an explicit null are both handed over as
 * {@code null}, which every size and length constraint treats as valid — clearing a list is
 * not a list that is too long.
 *
 * <p>Registered through {@code META-INF/services}, which is how Hibernate Validator discovers
 * value extractors, so every validator Spring builds has it.
 */
public class PatchedValueExtractor implements ValueExtractor<Patched<@ExtractedValue ?>> {

    @Override
    public void extractValues(Patched<?> originalValue, ValueReceiver receiver) {
        receiver.value(null, originalValue != null && originalValue.isPresent() ? originalValue.value() : null);
    }
}
