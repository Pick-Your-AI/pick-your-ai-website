/*
 * Component chooser for one kind (/catalog/:kindSlug).
 *
 * A dense part list with that kind's contract spec columns. Deep links from the builder are
 * preserved: ?replace=<selectionId> swaps a selection and returns, ?ids=<slug>,… seeds the compare
 * tray. Unknown components are listed, labelled Unknown and never filtered in as compatible.
 */
import { useParams } from 'react-router';
import { isComponentKind, kindFromSlug } from '../../contracts';
import NotFoundPage from '../../pages/NotFoundPage';
import { KindList } from './PartList';

export default function SelectionPage() {
  const { kindSlug } = useParams();
  const kind = kindSlug ? kindFromSlug(kindSlug) : undefined;
  if (!kind || !isComponentKind(kind)) return <NotFoundPage />;
  return (
    <div className="app-page parts-page">
      <div className="container">
        <KindList key={kind} kind={kind} />
      </div>
    </div>
  );
}
