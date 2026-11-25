/** Big tap-friendly "when?" pickers used by the task and reminder forms. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { addDays, today } from '@/domain/dates';
import type { HM, ISODate } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { Chip } from '@/ui/components';
import { DateField, PickerPill } from '@/ui/pickers';
import { Text } from '@/ui/Text';
import { font, useTheme } from '@/ui/theme';

const wrap = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 };

export function QuickDate({ value, onChange }: { value?: ISODate; onChange: (d: ISODate | undefined) => void }) {
  const tr = useT();
  const t = useTheme();
  const d0 = today();
  const presets: [string, ISODate | undefined][] = [
    [tr.quick.today, d0],
    [tr.quick.tomorrow, addDays(d0, 1)],
    [tr.quick.dayAfter, addDays(d0, 2)],
    [tr.quick.noDate, undefined],
  ];
  const isPreset = presets.some(([, v]) => v === value);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <View style={{ gap: 10 }}>
      <Text style={[font.small, { color: t.muted, fontWeight: '600' }]}>{tr.quick.when}</Text>
      <View style={wrap}>
        {presets.map(([label, v]) => (
          <Chip
            key={label}
            label={label}
            active={!custom && value === v}
            onPress={() => {
              setCustom(false);
              onChange(v);
            }}
          />
        ))}
        <Chip label={tr.quick.pickDate} icon="calendar-outline" active={custom} onPress={() => setCustom(true)} />
      </View>
      {custom && <DateField value={value} onChange={(v) => onChange(v ?? d0)} />}
    </View>
  );
}

const TIMES: HM[] = ['06:00', '09:00', '13:00', '17:00', '20:00', '22:00'];

export function timeLabel(hm: HM, lang: 'bn' | 'en'): string {
  const [h, m] = hm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m ? `:${String(m).padStart(2, '0')}` : '';
  if (lang === 'en') return `${h12}${mm} ${h < 12 ? 'AM' : 'PM'}`;
  const part = h < 4 ? 'রাত' : h < 6 ? 'ভোর' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 17 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  return `${part} ${h12}${mm}টা`;
}

export function QuickTime({ value, onChange, allowNone = true }: { value?: HM; onChange: (t: HM | undefined) => void; allowNone?: boolean }) {
  const tr = useT();
  const t = useTheme();
  const n = useNum();
  const lang = useData((s) => s.settings.language);
  const isPreset = value === undefined || TIMES.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <View style={{ gap: 10 }}>
      <Text style={[font.small, { color: t.muted, fontWeight: '600' }]}>{tr.quick.atTime}</Text>
      <View style={wrap}>
        {allowNone && (
          <Chip
            label={tr.quick.noTime}
            active={!custom && value === undefined}
            onPress={() => {
              setCustom(false);
              onChange(undefined);
            }}
          />
        )}
        {TIMES.map((hm) => (
          <Chip
            key={hm}
            label={n(timeLabel(hm, lang))}
            active={!custom && value === hm}
            onPress={() => {
              setCustom(false);
              onChange(hm);
            }}
          />
        ))}
        <Chip label={tr.quick.pickTime} icon="time-outline" active={custom} onPress={() => setCustom(true)} />
      </View>
      {custom && <PickerPill mode="time" value={value ?? '12:00'} onChange={onChange} />}
    </View>
  );
}
