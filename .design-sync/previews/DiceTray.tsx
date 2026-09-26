import { DiceTray, Die } from "yazy-battle-ui";

export const MidTurn = () => (
  <div style={{ width: 560 }}>
    <DiceTray>
      <Die held value={5} />
      <Die held value={5} />
      <Die value={2} />
      <Die held value={5} />
      <Die value={6} />
    </DiceTray>
  </div>
);

export const BeforeFirstRoll = () => (
  <div style={{ width: 560 }}>
    <DiceTray>
      <Die value={0} />
      <Die value={0} />
      <Die value={0} />
      <Die value={0} />
      <Die value={0} />
    </DiceTray>
  </div>
);

export const OpponentsTurn = () => (
  <div style={{ width: 560 }}>
    <DiceTray idle>
      <Die disabled value={3} />
      <Die disabled value={3} />
      <Die disabled value={4} />
      <Die disabled value={1} />
      <Die disabled value={3} />
    </DiceTray>
  </div>
);
