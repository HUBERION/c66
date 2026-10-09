n = int(input("n: "))
summe = 0
for i in range(1, n + 1):
    summe += i
print("Summe:", summe)

# Countdown
for k in range(n, 0, -1):
    print(k)

zahl = 0
while True:
    zahl = int(input("Note 1-5: "))
    if zahl >= 1 and zahl <= 5:
        break
print("Note:", zahl)

x = 100
while x > 1:
    if x % 2 == 0:
        x = x // 2
    else:
        x = 3 * x + 1
print("fertig", x)
for zeile in range(3):
    text = ""
    for spalte in range(zeile + 1):
        text = text + "*"
    print(text)
