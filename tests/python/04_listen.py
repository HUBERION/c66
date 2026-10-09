werte = [5, 3, 8, 1, 9, 2]
anzahl = len(werte)

# Bubblesort
for i in range(anzahl - 1):
    for j in range(anzahl - 1 - i):
        if werte[j] > werte[j + 1]:
            werte[j], werte[j + 1] = werte[j + 1], werte[j]

for w in werte:
    print(w)

quadrate = [0] * 5
for i in range(len(quadrate)):
    quadrate[i] = i * i
print("letztes:", quadrate[-1])


def summe(liste):
    s = 0
    for x in liste:
        s += x
    return s


print("Summe:", summe(quadrate))
