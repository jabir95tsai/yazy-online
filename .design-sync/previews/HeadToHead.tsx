import { FriendRow, HeadToHead } from "yazy-battle-ui";

export const WinsAndLosses = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <FriendRow detail="一起 12 場 · 平均 221 比 208" name="小明">
      <HeadToHead losses={5} wins={7} />
    </FriendRow>
  </section>
);

export const WithTies = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <FriendRow detail="一起 4 場 · 平均 198 比 205" name="阿凱">
      <HeadToHead losses={2} ties={1} wins={1} />
    </FriendRow>
  </section>
);
