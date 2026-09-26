import { FriendAction, FriendActions, FriendRow } from "yazy-battle-ui";

export const AcceptOrDecline = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <FriendRow detail="@mia_tw" name="Mia">
      <FriendActions>
        <FriendAction tone="accept">接受</FriendAction>
        <FriendAction tone="decline">不用了</FriendAction>
      </FriendActions>
    </FriendRow>
  </section>
);

export const PendingOutgoing = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <FriendRow detail="@kai" name="阿凱">
      <FriendActions>
        <FriendAction tone="decline">取消</FriendAction>
      </FriendActions>
    </FriendRow>
  </section>
);
