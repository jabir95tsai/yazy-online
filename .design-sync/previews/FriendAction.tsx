import { FriendAction, FriendActions, FriendRow } from "yazy-battle-ui";

const panel = { width: 420 };

export const Tones = () => (
  <section className="account-panel" style={panel}>
    <div className="friend-group">
      <FriendRow detail="@mia_tw" name="Mia">
        <FriendActions>
          <FriendAction tone="accept">接受</FriendAction>
          <FriendAction tone="decline">不用了</FriendAction>
        </FriendActions>
      </FriendRow>
      <FriendRow detail="@xiaoming" name="小明">
        <FriendAction tone="invite">邀請</FriendAction>
      </FriendRow>
    </div>
  </section>
);

export const Disabled = () => (
  <section className="account-panel" style={panel}>
    <div className="friend-group">
      <FriendRow detail="@kai" name="阿凱">
        <FriendAction disabled tone="invite">在桌上</FriendAction>
      </FriendRow>
      <FriendRow detail="@mia_tw" name="Mia">
        <FriendActions>
          <FriendAction disabled tone="decline">取消</FriendAction>
        </FriendActions>
      </FriendRow>
    </div>
  </section>
);
