import { Fragment } from 'react';

const NUMERIC = /(\d+(?:[.,]\d+)?\s?%|%\s?\d+(?:[.,]\d+)?)/g;
const IS_NUMERIC = /^(\d+(?:[.,]\d+)?\s?%|%\s?\d+(?:[.,]\d+)?)$/;

/**
 * نص عربي يحتوي نسبًا مئوية: تُعزل الأرقام مع علامة % (bdi باتجاه LTR)
 * حتى تظهر «50%» بنفس الشكل في كل الواجهة بدل «%50».
 */
export function MixedText({ text }: { text: string }) {
  const parts = text.split(NUMERIC);
  return (
    <>
      {parts.map((p, i) =>
        IS_NUMERIC.test(p) ? (
          <bdi key={i} dir="ltr" className="tabular">
            {p}
          </bdi>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
