import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { BasicsPanelCopy } from '@ideanest/campaign-editor/copy';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import {
  addCountry,
  countryOptions,
  isCountryRemovable,
  removeCountry,
} from '@ideanest/campaign-editor/countries';
import { Field, InlineAlert, RemovableChip, Select, Tag } from '../../components/ui';
import { useLocale } from '../../lib/locale';
import { spacing } from '../../theme';
import { countryName } from '../checkout/format';

export interface CountriesFieldProps {
  readonly copy: BasicsPanelCopy;
  readonly project: Pick<ProjectEdit, 'launchedAt' | 'countries'>;
  readonly value: readonly string[];
  readonly error?: string | undefined;
  readonly disabled?: boolean;
  readonly onChange: (countries: readonly string[]) => void;
}

export function CountriesField({ copy, project, value, error, disabled = false, onChange }: CountriesFieldProps) {
  const locale = useLocale();
  const options = useMemo(
    () =>
      countryOptions(value, (code) => countryName(code, locale), locale).map((option) => ({
        value: option.code,
        label: option.name,
      })),
    [value, locale],
  );
  const launched = project.launchedAt !== null && project.launchedAt !== undefined;

  return (
    <View style={styles.group}>
      <Field
        label={copy.countries}
        required
        hint={launched ? copy.countriesHintLaunched : copy.countriesHint}
        error={error}
      >
        <Select
          options={options}
          value={null}
          placeholder={copy.countriesAdd}
          disabled={disabled}
          onChange={(code) => onChange(addCountry(value, code))}
          testID="basics-countries-add"
        />
      </Field>

      <View style={styles.chips} accessibilityLabel={copy.countries} testID="basics-countries">
        {value.map((code) => {
          const name = countryName(code, locale);
          return isCountryRemovable(project, value, code) ? (
            <RemovableChip
              key={code}
              label={name}
              removeLabel={fillPlaceholders(copy.countriesRemove, { name })}
              disabled={disabled}
              onRemove={() => onChange(removeCountry(value, code))}
              testID={`basics-country-${code}`}
            />
          ) : (
            <Tag key={code} label={name} testID={`basics-country-${code}`} />
          );
        })}
      </View>

      <InlineAlert
        variant="info"
        politeness="off"
        description={copy.countriesDelivery}
        testID="basics-countries-delivery"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
