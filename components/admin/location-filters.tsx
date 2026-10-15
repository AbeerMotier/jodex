'use client';
import { SelectField } from './toolbar';
import { useFilterOptions, useLocationChoices } from './filters-context';

/** فلاتر الموقع المترابطة: المبنى ← الدور ← دورة المياه (من البيانات الفعلية) */
export function LocationFilters({
  building,
  floor,
  restroom,
  onChange,
  showFloor = true,
  showRestroom = true,
}: {
  building: string;
  floor: string;
  restroom: string;
  onChange: (patch: { building?: string | null; floor?: string | null; restroom?: string | null }) => void;
  showFloor?: boolean;
  showRestroom?: boolean;
}) {
  const options = useFilterOptions();
  const { floors, restrooms } = useLocationChoices(options, building, floor);
  return (
    <>
      <SelectField
        label="المبنى"
        value={building}
        testId="filter-building"
        onChange={(v) => onChange({ building: v || null, floor: null, restroom: null })}
        options={(options?.buildings ?? []).map((b) => ({ value: b.id, label: b.name }))}
        placeholder="كل المباني"
      />
      {showFloor && (
        <SelectField
          label="الدور"
          value={floor}
          testId="filter-floor"
          onChange={(v) => onChange({ floor: v || null, restroom: null })}
          options={floors.map((f) => ({ value: f, label: f }))}
          placeholder="كل الأدوار"
        />
      )}
      {showRestroom && (
        <SelectField
          label="دورة المياه"
          value={restroom}
          testId="filter-restroom"
          onChange={(v) => onChange({ restroom: v || null })}
          options={restrooms.map((r) => ({ value: r.id, label: `${r.name} · ${r.floor}${building ? '' : ` · ${r.building}`}` }))}
          placeholder="كل دورات المياه"
        />
      )}
    </>
  );
}
