# Eingabe – Verarbeitung – Ausgabe
name = input("Wie heißt du? ")
alter = int(input("Wie alt bist du? "))
jahre = 18 - alter

if alter >= 18:
    print(f"Hallo {name}, du bist volljährig.")
elif alter >= 14:
    print("Hallo", name, "- noch", jahre, "Jahre bis 18")
else:
    print("Hallo " + name + "!")
    print(f"In {jahre} Jahren bist du 18.")

summe = alter + 10
print("In 10 Jahren:", summe)
print(alter // 3, alter % 3, 2 ** 3)
