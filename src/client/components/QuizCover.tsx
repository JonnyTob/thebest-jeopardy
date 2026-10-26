import { useState } from 'react';
import { QuizName } from './Common';

export function QuizCover({ title, id, image }: { title: string; id: number; image: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="quiz-cover">
    {image && !failed && <img className="quiz-cover-image" src={image} alt="Quiz welcome artwork"
      onError={() => setFailed(true)} />}
    <div className="quiz-cover-overlay"><span className="eyebrow">WELCOME TO</span>
      <h1><QuizName title={title} id={id} /></h1>
      <p>Quick thinking. Big risks. Bragging rights.</p>
    </div>
    {failed && <div className="cover-error" role="alert">The quiz cover could not be loaded. Check the local image file.</div>}
  </div>;
}
