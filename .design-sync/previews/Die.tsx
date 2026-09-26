import { DiceTray, Die } from "yazy-battle-ui";

export const Faces = () => (
  <div style={{ width: 620 }}>
    <DiceTray>
      <Die value={1} />
      <Die value={2} />
      <Die value={3} />
      <Die value={4} />
      <Die value={5} />
      <Die value={6} />
    </DiceTray>
  </div>
);

export const HeldAndFree = () => (
  <div style={{ width: 320 }}>
    <DiceTray>
      <Die held value={6} />
      <Die value={2} />
    </DiceTray>
  </div>
);

export const NotRolledYet = () => (
  <div style={{ width: 320 }}>
    <DiceTray>
      <Die value={0} />
      <Die value={0} />
    </DiceTray>
  </div>
);
