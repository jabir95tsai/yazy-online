import { SegmentedTabs } from "yazy-battle-ui";

export const JoinCard = () => (
  <div className="join-card" style={{ width: 420 }}>
    <SegmentedTabs
      items={[
        { id: "create", label: "開一桌" },
        { id: "join", label: "加入朋友的桌" },
      ]}
      onChange={() => {}}
      value="create"
      variant="card"
    />
  </div>
);

export const ProfileWithBadge = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <SegmentedTabs
      items={[
        { id: "profile", label: "個人資料" },
        { id: "record", label: "戰績" },
        { id: "friends", label: "好友", badge: 2 },
      ]}
      onChange={() => {}}
      value="record"
    />
  </section>
);

export const LoginRegister = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <SegmentedTabs
      items={[
        { id: "login", label: "登入" },
        { id: "register", label: "註冊" },
      ]}
      onChange={() => {}}
      value="login"
    />
  </section>
);
