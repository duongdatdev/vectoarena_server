# VectoArena Database Redesign Notes

Tai lieu nay ghi lai thiet ke database moi cho VectoArena sau khi rut gon schema phuc vu prototype do an.

## 1. Huong thiet ke

Database chi luu du lieu tai khoan, lich su tran dau, kill log, reward tong ket, so cai tien te va skin da mo khoa.

Nhung du lieu thay doi lien tuc trong gameplay realtime, hoac du lieu balance co the doc tu file, khong luu thanh bang SQL rieng.

## 2. Bang bi loai bo

### 2.1 Runtime config

Bo 4 bang:

- `GameConfigProfile`
- `WeaponBalanceConfig`
- `ItemBalanceConfig`
- `GameRuleSetting`

Ly do:

- Thong so sung, item, vong bo va rule tran dau duoc luu trong file JSON tren server Node.js.
- Server load JSON vao RAM khi khoi dong hoac khi refresh config.
- Khong can query DB cho gameplay balance.
- De demo do an, file JSON de sua va de giai thich hon admin config database.

File config hien tai:

```text
VectoArena_Server/config/gameplay/default.json
```

### 2.2 Item pickup telemetry

Bo bang:

- `MatchItemPickup`

Ly do:

- Nhung su kien nhat mau, sung, dan co the xay ra lien tuc.
- Ghi tat ca vao SQL lam phinh database nhanh trong khi gia tri audit khong cao.
- Anti-cheat prototype chi can `KillEvent`, validation server-side va thong ke tong hop tren `MatchParticipant`.

Luu y: VEC khong log tung pickup nua. Server chi cong don vao cac cot tong hop cua `MatchParticipant`.

### 2.3 Reward table

Bo bang:

- `MatchReward`

Ly do:

- Reward sau tran la ket qua truc tiep cua moi participant.
- Ghi `rewardVec` va `rewardXp` vao `MatchParticipant` la du de xem lich su/profile.
- Neu co phat VEC vao wallet, tao them dong trong `CurrencyTransaction`.

## 3. Bang giu lai va chinh sua

### 3.1 User

`User.vecBalance` doi tu `Float` sang `Int` de tranh sai so so hoc.

`User.coinBalance` la soft currency off-chain dung cho shop skin hien tai, mac dinh 1500 coin cho tai khoan moi.

Quy uoc:

- `coinBalance`: tien giao dich truoc mat trong shop, khong lien quan blockchain.
- `vecBalance`: giu cho VEC/Web3 sau nay, chi dung cho reward blockchain hoac mot so skin dac biet can VEC.

Them:

```prisma
walletAddress String?
```

`walletAddress` dung cho demo Sepolia neu nguoi choi lien ket vi.

### 3.2 Match

`Match` khong con `configProfileId`.

Neu can luu cau hinh tran da dung, co the snapshot vao:

```prisma
zoneConfig Json?
```

Hoac them `gameplayConfigSnapshot Json?` sau nay neu can audit chi tiet.

### 3.3 MatchParticipant

`MatchParticipant` la bang tong ket ket qua cua tung nguoi trong tran.

Them cac cot:

```prisma
vecCollected Int @default(0)
vecDropped   Int @default(0)
vecCarried   Int @default(0)
rewardVec    Int @default(0)
rewardXp     Int @default(0)
```

Y nghia:

- `vecCollected`: tong VEC nhat duoc trong tran.
- `vecDropped`: tong VEC da roi ra khi chet.
- `vecCarried`: VEC con giu luc ket thuc.
- `rewardVec`: VEC hop le duoc cong vao wallet.
- `rewardXp`: XP sau tran neu can profile progression.

### 3.4 KillEvent

Giu `KillEvent` lam log combat chinh.

Nen luu them:

```prisma
deathCause DeathCause @default(PLAYER)
x          Float?
y          Float?
z          Float?
```

`deathCause` gom:

```prisma
enum DeathCause {
  PLAYER
  ZONE
  DISCONNECT
  SYSTEM
}
```

### 3.5 UserLoadout

Do gameplay dung loot weapon trong tran, loadout khong luu sung mac dinh nua.

Doi thanh:

```prisma
equippedWeaponSkin String?
equippedPlayerSkin String?
```

Hai cot nay chi dai dien cosmetic, khong anh huong damage, HP, fire rate, range hay toc do.

### 3.6 CurrencyTransaction

`CurrencyTransaction` la so cai chung cho ca COIN off-chain va VEC/Web3 demo.

Nen dung `Int` cho amount/balance:

```prisma
currencyType  CurrencyType
amount        Int
balanceBefore Int
balanceAfter  Int
```

`currencyType` gom:

```prisma
enum CurrencyType {
  COIN
  VEC
}
```

Flow shop hien tai:

1. User mua skin bang `COIN`.
2. Server update `User.coinBalance`.
3. Server tao `CurrencyTransaction` voi `currencyType = COIN`, `type = PURCHASE`, `status = OFFCHAIN_ONLY`.
4. Server tao dong `SkinInventory`.
5. Server update `UserLoadout.equippedPlayerSkin` neu mua xong auto equip.

Them cac cot Web3:

```prisma
status          TransactionStatus @default(OFFCHAIN_ONLY)
txHash          String?
chainId         Int?
contractAddress String?
```

Trang thai:

```prisma
enum TransactionStatus {
  PENDING
  SUCCESS
  FAILED
  OFFCHAIN_ONLY
}
```

Flow:

1. Server tinh `rewardVec`.
2. Server update `MatchParticipant.rewardVec`.
3. Server update `User.vecBalance`.
4. Server tao `CurrencyTransaction` voi `currencyType = VEC`.
5. Neu bat Sepolia, transaction ban dau la `PENDING`.
6. Khi co ket qua blockchain, update `txHash` va `status`.

## 4. Bang moi

### 4.1 SkinInventory

Them bang chuyen biet de luu skin user da mua hoac duoc thuong.

```prisma
model SkinInventory {
  id         String     @id @default(uuid()) @db.Uuid
  userId     String     @db.Uuid
  skinCode   String     @db.VarChar(64)
  skinType   SkinType
  source     SkinSource @default(SHOP)
  unlockedAt DateTime   @default(now())
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, skinCode])
  @@index([userId, skinType])
}
```

Enum:

```prisma
enum SkinType {
  WEAPON
  PLAYER
}

enum SkinSource {
  SHOP
  REWARD
  ADMIN
}
```

Trong prototype, `skinCode` co the la string nhu `rifle_red`, `shotgun_gold`, `player_blue`. Chua can bang `Skin` rieng neu danh sach skin duoc khai bao bang JSON/config trong code.

## 5. Enum item

Them item gameplay moi:

```prisma
enum ItemType {
  RIFLE
  SHOTGUN
  MEDICAL_KIT
  VEC
  AIRDROP
}
```

`VEC` va `AIRDROP` xuat hien trong state/gameplay, nhung pickup chi cap nhat tong hop vao `MatchParticipant`, khong ghi `MatchItemPickup`.

## 6. Thu tu trien khai khuyen nghi

1. Apply schema moi va generate Prisma client.
2. Cap nhat server de load gameplay balance tu JSON.
3. Bo ghi `MatchItemPickup`.
4. Them alive/dead va finalize placement.
5. Cap nhat `MatchParticipant.rewardVec`, `vecCollected`, `vecDropped`, `vecCarried`.
6. Tao `CurrencyTransaction` khi cong VEC vao wallet.
7. Them shop/inventory su dung `SkinInventory`.
8. Neu demo Web3, update `txHash` va `status` sau khi goi Sepolia.

## 7. Ket luan

Thiet ke moi phu hop hon voi prototype:

- Database gon hon.
- It ghi SQL trong gameplay realtime.
- Balance game de sua bang JSON.
- Reward sau tran nam ngay tren `MatchParticipant`.
- Web3 ledger co du `txHash` va `status`.
- Economy bam sat muc tieu skin-only.
