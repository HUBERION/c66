def fakultaet(n: int) -> int:
    if n <= 1:
        return 1
    return n * fakultaet(n - 1)


def betrag(x):
    if x < 0:
        return -x
    return x


def ggt(a, b):
    while a != b:
        if a > b:
            a = a - b
        else:
            b = b - a
    return a


def gruss(name):
    print("Servus", name)


zahl = int(input("Zahl: "))
print(zahl, "! =", fakultaet(zahl))
print("Betrag:", betrag(-zahl))
print("ggT:", ggt(48, 18))
gruss("Ada")
print("min/max:", min(zahl, 3), max(zahl, 3), abs(-7))
