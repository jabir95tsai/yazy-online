import { FriendAction, FriendActions, FriendRow, HeadToHead } from "yazy-battle-ui";

const panel = { width: 420 };

export const IncomingRequest = () => (
  <section className="account-panel" style={panel}>
    <div className="friend-group">
      <h3>等你回覆</h3>
      <FriendRow detail="@mia_tw" name="Mia">
        <FriendActions>
          <FriendAction tone="accept">接受</FriendAction>
          <FriendAction tone="decline">不用了</FriendAction>
        </FriendActions>
      </FriendRow>
    </div>
  </section>
);

export const FriendList = () => (
  <section className="account-panel" style={panel}>
    <div className="friend-group">
      <h3>好友 3</h3>
      <FriendRow detail="一起 12 場 · 7 勝 5 敗" name="小明">
        <FriendActions>
          <FriendAction tone="decline">移除</FriendAction>
        </FriendActions>
      </FriendRow>
      <FriendRow detail="一起 4 場 · 1 勝 2 敗 1 和" name="阿凱">
        <FriendActions>
          <FriendAction tone="decline">移除</FriendAction>
        </FriendActions>
      </FriendRow>
      <FriendRow detail="0 場 · 還沒同桌過" name="Mia">
        <FriendActions>
          <FriendAction tone="decline">移除</FriendAction>
        </FriendActions>
      </FriendRow>
    </div>
  </section>
);

export const InviteToTable = () => (
  <section className="account-panel" style={panel}>
    <div className="friend-group">
      <FriendRow detail="@xiaoming" name="小明">
        <FriendAction tone="invite">邀請</FriendAction>
      </FriendRow>
      <FriendRow detail="@kai" name="阿凱">
        <FriendAction disabled tone="invite">已邀請</FriendAction>
      </FriendRow>
    </div>
  </section>
);

export const Rival = () => (
  <section className="account-panel" style={panel}>
    <div className="friend-group">
      <h3>好友對戰</h3>
      <FriendRow detail="一起 12 場 · 平均 221 比 208" name="小明">
        <HeadToHead losses={5} wins={7} />
      </FriendRow>
    </div>
  </section>
);
